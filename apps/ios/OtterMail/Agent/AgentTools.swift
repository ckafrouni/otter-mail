import Foundation
import FoundationModels

/**
 * The tools Apple's model has on the iPhone (AppleAgent.swift): core's
 * on-device toolset (packages/core agent/tools/on-device.ts), the same six
 * tools by the same names, arguments and results, over the mail on this
 * iPhone (the MailStore). A change asks first (drafts don't), and what goes
 * wrong goes back to the model to read.
 */
final class AgentTools {
    /** The mail the app shows (the demo's, or the account's). */
    var mailStore: () -> MailStore? = { nil }
    /** Asks before a change, with exactly what will happen; throws when the user declines. */
    var confirm: (_ tool: String, _ title: String, _ detail: String) async throws -> Void = { _, _, _ in }
    /** Told of each call: the step's title, and its result. */
    var onStep: (_ title: String, _ output: String) -> Void = { _, _ in }

    var all: [any OtterTool] {
        [ListInbox(tools: self), SearchMail(tools: self), ReadConversation(tools: self),
         SaveReply(tools: self), WriteEmail(tools: self), UpdateConversation(tools: self)]
    }

    /** A tool's title ("Search mail"), for the chat's steps. */
    func title(of name: String) -> String { all.first { $0.name == name }?.title ?? name }

    /** Runs a tool's work where the mail is: its result, or what went wrong. */
    fileprivate func run(_ tool: some OtterTool, _ work: @MainActor () async throws -> String) async -> String {
        let output: String
        do { output = try await work() } catch { output = "Error: \(error.localizedDescription)" }
        onStep(tool.title, output)
        return output
    }

    fileprivate var store: MailStore {
        get throws {
            guard let store = mailStore() else { throw ToolError("There's no mail here yet.") }
            return store
        }
    }

    fileprivate func conversation(_ id: String) throws -> MailThread {
        guard let thread = try store.thread(id) else { throw ToolError("No conversation \(id). Copy its id from list_inbox or search_mail.") }
        return thread
    }

    fileprivate func mailbox(of thread: MailThread) throws -> Mailbox {
        guard let mailbox = try store.mailbox(thread.mailbox) else { throw ToolError("No mailbox \(thread.mailbox).") }
        return mailbox
    }

    /** Conversations as the model reads them: one line each with its id, then a line of the latest message. */
    fileprivate static func list(_ threads: [MailThread], empty: String) -> String {
        guard !threads.isEmpty else { return empty }
        return threads.prefix(12).map { t in
            "- id \(t.id): \(address(t.latest.from)) · “\(t.subject)” · \(date(t.latest.date))\(t.unread ? " · unread" : "")\n  \(t.latest.snippet.prefix(120))"
        }.joined(separator: "\n")
    }

    fileprivate static func address(_ person: Person) -> String {
        person.name.isEmpty || person.name == person.email ? person.email : "\(person.name) <\(person.email)>"
    }

    fileprivate static func date(_ date: Date) -> String { dateFormat.string(from: date) }

    private static let dateFormat = {
        let format = DateFormatter()
        format.locale = Locale(identifier: "en_US_POSIX")
        format.dateFormat = "yyyy-MM-dd HH:mm"
        return format
    }()
}

nonisolated struct ToolError: LocalizedError {
    var errorDescription: String?
    init(_ message: String) { errorDescription = message }
}

/** A tool with core's title ("Search mail"), for the chat's steps and approvals. */
nonisolated protocol OtterTool: Tool {
    var title: String { get }
}

// ── The tools ────────────────────────────────────────────────────────────────

nonisolated struct ListInbox: OtterTool {
    let tools: AgentTools
    let name = "list_inbox"
    let title = "List the inbox"
    let description = "The newest conversations in the user's inbox, each with its id."

    @Generable struct Arguments {
        var unreadOnly: Bool?
    }

    func call(arguments: Arguments) async throws -> String {
        await tools.run(self) {
            let unreadOnly = arguments.unreadOnly ?? false
            let threads = try tools.store.threads(in: .inbox, scope: nil).filter { !unreadOnly || $0.unread }
            return AgentTools.list(threads, empty: unreadOnly ? "Nothing unread in the inbox." : "The inbox is empty.")
        }
    }
}

nonisolated struct SearchMail: OtterTool {
    let tools: AgentTools
    let name = "search_mail"
    let title = "Search mail"
    let description = "Finds conversations by words (names, subjects, text) and answers them, newest first, each with its id."

    @Generable struct Arguments {
        @Guide(description: "A few words, like “ada lunch”.") var query: String
    }

    func call(arguments: Arguments) async throws -> String {
        await tools.run(self) {
            AgentTools.list(try tools.store.search(arguments.query, scope: nil), empty: "Nothing matches.")
        }
    }
}

nonisolated struct ReadConversation: OtterTool {
    let tools: AgentTools
    let name = "read_conversation"
    let title = "Read a conversation"
    let description = "A conversation's messages, oldest first: who wrote each, when, and what."

    @Generable struct Arguments {
        @Guide(description: "The conversation's id, copied from list_inbox or search_mail.") var id: String
    }

    func call(arguments: Arguments) async throws -> String {
        await tools.run(self) {
            let thread = try tools.conversation(arguments.id)
            let messages = thread.sent.map { m in
                "\(AgentTools.address(m.from)), \(AgentTools.date(m.date)):\n\(Quote.split(m.text).body.prefix(1_500))"
            }
            return (["“\(thread.subject)”"] + messages).joined(separator: "\n\n")
        }
    }
}

nonisolated struct SaveReply: OtterTool {
    let tools: AgentTools
    let name = "save_reply"
    let title = "Save a reply"
    let description = "Writes a reply to a conversation into Drafts, for the user to check and send. It sends nothing."

    @Generable struct Arguments {
        @Guide(description: "The conversation's id, copied from list_inbox or search_mail.") var id: String
        @Guide(description: "The reply, greeting and sign-off included.") var text: String
    }

    // A draft sends nothing and is the user's to look at: no approval.
    func call(arguments: Arguments) async throws -> String {
        await tools.run(self) {
            let thread = try tools.conversation(arguments.id)
            var draft = Draft.reply(to: thread, in: try tools.mailbox(of: thread), all: false)
            draft.body = arguments.text.trimmingCharacters(in: .whitespacesAndNewlines) + draft.body
            try await tools.store.save(draft)
            return "Saved the reply in Drafts."
        }
    }
}

nonisolated struct WriteEmail: OtterTool {
    let tools: AgentTools
    let name = "write_email"
    let title = "Write an email"
    let description = "Writes a new email into Drafts, for the user to check and send. It sends nothing."

    @Generable struct Arguments {
        @Guide(description: "The mailbox to write from, by address; optional when there's only one.") var from: String?
        @Guide(description: "Email addresses, comma-separated.") var to: String
        var subject: String
        @Guide(description: "The email, greeting and sign-off included.") var text: String
    }

    func call(arguments: Arguments) async throws -> String {
        await tools.run(self) {
            // It can't know the user's address: with one mailbox, that's the one.
            let mailboxes = try tools.store.mailboxes
            let from = arguments.from?.lowercased()
            let named = from.flatMap { from in mailboxes.first { $0.email.lowercased() == from } }
            guard let mailbox = named ?? (mailboxes.count == 1 ? mailboxes.first : nil) else {
                throw ToolError("\"from\" is one of: \(mailboxes.map(\.email).joined(separator: ", ")).")
            }
            var draft = Draft.new(from: mailbox, to: arguments.to)
            draft.subject = arguments.subject
            draft.body = arguments.text.trimmingCharacters(in: .whitespacesAndNewlines) + draft.body
            try await tools.store.save(draft)
            return "Saved the email in Drafts."
        }
    }
}

nonisolated struct UpdateConversation: OtterTool {
    let tools: AgentTools
    let name = "update_conversation"
    let title = "Update a conversation"
    let description = "Archives, trashes, marks read or unread, stars or unstars a conversation, or moves it back to the inbox."

    @Generable enum Action {
        case archive, trash, mark_read, mark_unread, star, unstar, move_to_inbox
    }

    @Generable struct Arguments {
        @Guide(description: "The conversation's id, copied from list_inbox or search_mail.") var id: String
        var action: Action
    }

    func call(arguments: Arguments) async throws -> String {
        await tools.run(self) {
            let store = try tools.store
            let thread = try tools.conversation(arguments.id)
            // What will happen, as core's update_threads and trash_threads word it.
            let what = switch arguments.action {
            case .archive: "Archive: 1 conversation in \(thread.mailbox)"
            case .trash: "Move 1 conversation in \(thread.mailbox) to the Trash"
            case .mark_read: "Mark read: 1 conversation in \(thread.mailbox)"
            case .mark_unread: "Mark unread: 1 conversation in \(thread.mailbox)"
            case .star: "Star: 1 conversation in \(thread.mailbox)"
            case .unstar: "Unstar: 1 conversation in \(thread.mailbox)"
            case .move_to_inbox: "Move to the inbox: 1 conversation in \(thread.mailbox)"
            }
            try await tools.confirm(name, title, "\(what)\n“\(thread.subject)”")
            switch arguments.action {
            case .archive: store.archive(thread.id)
            case .trash: store.trash(thread.id)
            case .mark_read: store.setRead(true, thread.id)
            case .mark_unread: store.setRead(false, thread.id)
            case .star: if !thread.starred { store.toggleStar(thread.id) }
            case .unstar: if thread.starred { store.toggleStar(thread.id) }
            case .move_to_inbox: store.moveToInbox(thread.id)
            }
            return "Done."
        }
    }
}
