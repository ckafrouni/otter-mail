import Foundation
import Observation

/**
 * The agent, as on the desktop (core's agent service and the renderer's
 * chat). Two run here: Apple's on-device model (AppleAgent.swift), with Otter
 * Mail's tools on this iPhone, and Hermes, with the same chats (they live on
 * the Hermes server) and the same settings and key (they follow the Otter
 * account). Codex and Claude are local agents on the Mac; the phone lists
 * them, off.
 */
@Observable
final class Agent {
    enum Provider: String, CaseIterable, Identifiable {
        case apple, hermes

        var id: String { rawValue }
        var name: String { self == .apple ? "Apple" : "Hermes" }
    }

    /** The account's `assistant.hermes` settings, under the desktop's names. */
    struct HermesSettings: Codable, Equatable {
        var enabled = true
        var baseUrl = ""
        var agentModel = ""
        /** `provider::model`; empty → the gateway's default. */
        var model = ""
        /** Empty → the gateway's default; "none" → off. */
        var reasoningEffort = ""
        /** Empty or "default" → standard; "priority" → fast. */
        var serviceTier = ""
        var sessions: Bool?

        init() {}

        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            enabled = try c.decodeIfPresent(Bool.self, forKey: .enabled) ?? true
            baseUrl = try c.decodeIfPresent(String.self, forKey: .baseUrl) ?? ""
            agentModel = try c.decodeIfPresent(String.self, forKey: .agentModel) ?? ""
            model = try c.decodeIfPresent(String.self, forKey: .model) ?? ""
            reasoningEffort = try c.decodeIfPresent(String.self, forKey: .reasoningEffort) ?? ""
            serviceTier = try c.decodeIfPresent(String.self, forKey: .serviceTier) ?? ""
            sessions = try c.decodeIfPresent(Bool.self, forKey: .sessions)
        }
    }

    enum Status: Equatable {
        case notConfigured
        case checking
        case ready
        case failed(String)
    }

    struct Tool: Identifiable {
        let id = UUID()
        var name: String
        var output: String?
    }

    /** An agent asking before it does something: Hermes running a command, Apple's model changing mail. */
    struct Approval: Equatable {
        var id: String
        /** "Allow Apple to send email?" */
        var question: String
        /** Exactly what will happen, shown verbatim. */
        var detail: String?
        /** A command, shown as code. */
        var isCommand = false
        var reason: String?
        var choices: [String]
    }

    /** A kept chat, from Hermes or this iPhone. */
    struct Chat: Identifiable, Hashable {
        var id: String
        var title: String?
        var preview: String?
        var lastActive: Date
    }

    struct Turn: Identifiable {
        enum Role { case user, agent }
        let id = UUID()
        var role: Role
        var text: String
        var tools: [Tool] = []
        /** The conversations attached to a question (their subjects, for the chip). */
        var context: [String] = []
        var approval: Approval?
        var error: String?
    }

    // ── Settings, shared with the account ────────────────────────────────────

    var hermes: HermesSettings { didSet { settingsChanged() } }
    private(set) var hasKey: Bool
    /** Told when the settings (`assistant`) or the key (`hermesKey`) change here, to sync them. */
    @ObservationIgnored var onChange: (String) -> Void = { _ in }
    /** The account's whole `assistant` section, kept so writes don't drop the Mac's Codex and Claude settings. */
    @ObservationIgnored private var section: [String: Any]
    @ObservationIgnored private var applying = false

    /** Which one this iPhone asks (its own choice: the web can't run Apple's). */
    var provider: Provider {
        didSet {
            UserDefaults.standard.set(provider.rawValue, forKey: Self.providerKey)
            newChat()
        }
    }
    @ObservationIgnored let apple = AppleAgent()

    private static let settingsKey = "assistant" // stored and synced under its old name
    private static let providerKey = "assistant:provider"
    private static let keychainKey = "hermes-key"

    init() {
        let data = UserDefaults.standard.data(forKey: Self.settingsKey) ?? Data()
        section = (try? JSONSerialization.jsonObject(with: data) as? [String: Any]) ?? [:]
        hermes = Self.decode(section["hermes"]) ?? HermesSettings()
        let hasKey = Keychain.get(Self.keychainKey) != nil
        self.hasKey = hasKey
        provider = UserDefaults.standard.string(forKey: Self.providerKey).flatMap(Provider.init) ?? (hasKey ? .hermes : .apple)
        apple.approve = { [unowned self] approval in await waitForAnswer(approval) }
        apple.tools.onStep = { [unowned self] title, output in
            updateLast { $0.tools.append(Tool(name: title, output: String(output.prefix(400)))) }
        }
    }

    private static func decode(_ value: Any?) -> HermesSettings? {
        guard let value, let data = try? JSONSerialization.data(withJSONObject: value) else { return nil }
        return try? JSONDecoder().decode(HermesSettings.self, from: data)
    }

    /** The section as this device would write it. */
    var syncedSection: [String: Any] {
        var section = section
        let own = (try? JSONSerialization.jsonObject(with: JSONEncoder().encode(hermes))) as? [String: Any] ?? [:]
        section["hermes"] = (section["hermes"] as? [String: Any] ?? [:]).merging(own) { _, mine in mine }
        return section
    }

    private func settingsChanged() {
        section = syncedSection
        UserDefaults.standard.set(try? JSONSerialization.data(withJSONObject: section), forKey: Self.settingsKey)
        if !applying { onChange("assistant") }
    }

    /** Takes the account's settings and key (from another device). */
    func apply(section remote: [String: Any]?, key: String?) {
        applying = true
        defer { applying = false }
        if let remote {
            section = remote
            let next = Self.decode(remote["hermes"]) ?? HermesSettings()
            if next != hermes { hermes = next }
        }
        if let key, key != Keychain.get(Self.keychainKey) {
            Keychain.set(Self.keychainKey, key)
            hasKey = true
        }
        Task { await check() }
    }

    var key: String? { Keychain.get(Self.keychainKey) }

    /** Connects to a Hermes server (from Settings › Agents), for every device. */
    func connect(url: String, key: String) async {
        Keychain.set(Self.keychainKey, key)
        hasKey = true
        hermes.baseUrl = Hermes.normalized(url)
        onChange("hermesKey")
        await check()
    }

    func disconnect() {
        Keychain.set(Self.keychainKey, nil)
        hasKey = false
        hermes.baseUrl = ""
        status = .notConfigured
        onChange("hermesKey")
    }

    /** Forgets the key here (the Otter account it came with signed out). */
    func forgetKey() {
        Keychain.set(Self.keychainKey, nil)
        hasKey = false
        status = .notConfigured
    }

    // ── Status and models ────────────────────────────────────────────────────

    /** Hermes' status. */
    private(set) var status: Status = .notConfigured
    private(set) var models: [Hermes.Model] = []

    /** The chosen provider's status. */
    var current: Status {
        guard provider == .apple else { return status }
        return AppleAgent.unavailable.map(Status.failed) ?? .ready
    }

    private var client: Hermes? {
        guard hermes.enabled, !hermes.baseUrl.isEmpty, let key else { return nil }
        return Hermes(baseURL: Hermes.normalized(hermes.baseUrl), key: key)
    }

    func check() async {
        guard let client else { status = .notConfigured; return }
        status = .checking
        do {
            let (models, sessions) = try await client.check()
            self.models = models
            if hermes.sessions != sessions {
                applying = true
                hermes.sessions = sessions
                applying = false
            }
            status = .ready
        } catch {
            status = .failed("Can't reach Hermes: \(error.localizedDescription)")
        }
    }

    /** The model new turns use: the one chosen, else the gateway's default. */
    var model: Hermes.Model? {
        models.first { $0.slug == hermes.model && !hermes.model.isEmpty } ?? models.first(where: \.isDefault) ?? models.first
    }

    private var modelFields: [String: Any] {
        var fields: [String: Any] = [:]
        let parts = hermes.model.components(separatedBy: "::")
        if parts.count == 2 {
            fields["provider"] = parts[0]
            fields["model"] = parts[1]
        }
        var options: [String: Any] = [:]
        if hermes.reasoningEffort == "none" {
            options["reasoning"] = ["enabled": false]
        } else if !hermes.reasoningEffort.isEmpty {
            options["reasoning"] = ["effort": hermes.reasoningEffort]
        }
        if !hermes.serviceTier.isEmpty, hermes.serviceTier != "default" { options["service_tier"] = hermes.serviceTier }
        if !options.isEmpty { fields["model_options"] = options }
        return fields
    }

    // ── The chat ─────────────────────────────────────────────────────────────

    private(set) var turns: [Turn] = []
    private(set) var session: String?
    private(set) var running = false
    @ObservationIgnored private var run: String?
    @ObservationIgnored private var streaming: Task<Void, Never>?
    /** Apple's model waiting on an approval. */
    @ObservationIgnored private var answering: CheckedContinuation<String, Never>?

    func newChat() {
        stop()
        turns = []
        session = nil
        apple.newChat()
    }

    /** Asks, with the conversations as pointers (the desktop's handoff block). */
    func send(_ text: String, context: [MailContext] = []) {
        let question = text.trimmingCharacters(in: .whitespacesAndNewlines)
        if provider == .apple { return askApple(question, context: context) }
        guard let client, !question.isEmpty || !context.isEmpty else { return }
        if running, let run {
            // Mid-turn: it lands after the current tool calls.
            Task { if await client.steer(run: run, question) { self.turns.append(Turn(role: .user, text: question)) } }
            return
        }
        turns.append(Turn(role: .user, text: question, context: context.map(\.subject)))
        turns.append(Turn(role: .agent, text: ""))
        running = true
        let message = MailContext.handoff(question, context, reader: "Fetch full content with gog if needed.")
        let fields = modelFields
        streaming = Task {
            do {
                if session == nil {
                    session = try await client.createSession(title: String(question.prefix(60)))
                }
                for try await event in client.turn(session: session!, message: message, model: fields) {
                    handle(event)
                }
            } catch is CancellationError {
            } catch {
                updateLast { $0.error = error.localizedDescription }
            }
            running = false
            run = nil
            await loadHistory()
        }
    }

    /** Asks Apple's model, with the conversations as pointers it reads with get_thread. */
    private func askApple(_ question: String, context: [MailContext]) {
        guard !running, !question.isEmpty, current == .ready else { return }
        turns.append(Turn(role: .user, text: question, context: context.map(\.subject)))
        turns.append(Turn(role: .agent, text: ""))
        running = true
        let prompt = MailContext.handoff(question, context, reader: "Read them with the otter-mail tools (get_thread) if needed.")
        streaming = Task {
            do {
                try await apple.respond(to: prompt, title: String(question.prefix(60))) { text in
                    updateLast { $0.text = text }
                }
            } catch {
                if !Task.isCancelled { updateLast { $0.error = AppleAgent.message(error) } }
            }
            running = false
        }
    }

    private func handle(_ event: Hermes.Event) {
        switch event {
        case .run(let id): run = id
        case .delta(let text): updateLast { $0.text += text }
        case .tool(let name): updateLast { $0.tools.append(Tool(name: name)) }
        case .toolResult(let output): updateLast { t in if !t.tools.isEmpty { t.tools[t.tools.count - 1].output = output } }
        case .approval(let id, let command, let reason, let choices):
            updateLast {
                $0.approval = Approval(id: id, question: "Allow Hermes to run this command?", detail: command, isCommand: true, reason: reason, choices: choices)
            }
        case .completed(let steer):
            if let steer { turns.append(Turn(role: .user, text: steer, error: "Hermes finished before this; send it again.")) }
        case .failed(let message): updateLast { $0.error = message }
        }
    }

    /** What the running turn is waiting on, shown in the composer's place. */
    var pendingApproval: Approval? { turns.last { $0.role == .agent }?.approval }

    private func updateLast(_ change: (inout Turn) -> Void) {
        guard let i = turns.lastIndex(where: { $0.role == .agent }) else { return }
        change(&turns[i])
    }

    func stop() {
        answering?.resume(returning: "deny")
        answering = nil
        if let run, let client { Task { await client.stop(run: run) } }
        streaming?.cancel()
        streaming = nil
        running = false
    }

    func answer(_ approval: Approval, _ choice: String) {
        if provider == .apple {
            updateLast { $0.approval = nil }
            answering?.resume(returning: choice)
            answering = nil
            return
        }
        guard let client, let run else { return }
        Task {
            try? await client.approve(run: run, request: approval.id, choice: choice)
            updateLast { $0.approval = nil }
        }
    }

    private func waitForAnswer(_ approval: Approval) async -> String {
        await withCheckedContinuation { continuation in
            answering = continuation
            updateLast { $0.approval = approval }
        }
    }

    // ── History ──────────────────────────────────────────────────────────────

    private(set) var history: [Chat] = []

    func loadHistory() async {
        if provider == .apple {
            history = AppleAgent.chats().map { Chat(id: $0.id, title: $0.title, lastActive: $0.lastActive) }
            return
        }
        guard let client else { return }
        history = (try? await client.sessions())?.map { Chat(id: $0.id, title: $0.title, preview: $0.preview, lastActive: $0.lastActive) } ?? history
    }

    func open(_ chat: Chat) async {
        if provider == .apple {
            guard let kept = AppleAgent.chat(chat.id) else { return }
            newChat()
            apple.open(kept)
            turns = apple.turns(kept.transcript)
            return
        }
        guard let client else { return }
        newChat()
        session = chat.id
        let messages = (try? await client.messages(of: chat.id)) ?? []
        var turns: [Turn] = []
        for message in messages {
            switch message.role {
            case "user":
                // Show the question, not the context block sent with it.
                let text = message.text.components(separatedBy: MailContext.marker).first ?? message.text
                turns.append(Turn(role: .user, text: text.trimmingCharacters(in: .whitespacesAndNewlines)))
            case "assistant":
                if let last = turns.last, last.role == .agent {
                    turns[turns.count - 1].text += (last.text.isEmpty ? "" : "\n\n") + message.text
                    turns[turns.count - 1].tools += message.tools.map { Tool(name: $0) }
                } else {
                    turns.append(Turn(role: .agent, text: message.text, tools: message.tools.map { Tool(name: $0) }))
                }
            default:
                break
            }
        }
        self.turns = turns
    }

    func delete(_ chat: Chat) async {
        if provider == .apple {
            AppleAgent.delete(chat.id)
            if apple.chat?.id == chat.id { newChat() }
        } else {
            guard let client else { return }
            try? await client.delete(session: chat.id)
            if session == chat.id { newChat() }
        }
        history.removeAll { $0.id == chat.id }
    }
}

/**
 * A conversation handed to the agent as a pointer (apps/web's
 * chat-context.ts): the agent reads the mail itself, so only ids and a subject
 * go with the question.
 */
struct MailContext: Hashable {
    var account: String
    var threadID: String
    var subject: String
    var from: String
    var messageIDs: [String]

    static let marker = "\n\n— context from Otter Mail —"

    init(_ thread: MailThread) {
        account = thread.mailbox
        threadID = thread.id
        subject = thread.subject.isEmpty ? "(no subject)" : thread.subject
        from = thread.latest.from.email
        messageIDs = [thread.latest.id]
    }

    /** The question, then the pointer block and how to read what it points at, as the desktop sends it. */
    static func handoff(_ question: String, _ context: [MailContext], reader: String) -> String {
        guard !context.isEmpty else { return question }
        var lines = [question, "", "— context from Otter Mail —"]
        for c in context {
            lines.append("• [\(c.account)] \"\(c.subject)\" — from \(c.from) (threadId \(c.threadID), message \(c.messageIDs.joined(separator: ", ")))")
        }
        lines.append(reader)
        return lines.joined(separator: "\n")
    }
}
