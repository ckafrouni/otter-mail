import SwiftUI

/**
 * Settings › Agents, as on the desktop: which one to ask, Apple's
 * on-device model, Hermes' connection and model (following the Otter
 * account, key included), and the Mac's local agents, listed but off here.
 */
struct AgentSettings: View {
    @Environment(Session.self) private var session
    @Environment(\.palette) private var palette

    @State private var url = ""
    @State private var key = ""
    @State private var connecting = false

    var body: some View {
        @Bindable var agent = session.agent
        SettingsForm {
            Section {
                Picker("Ask", selection: $agent.provider) {
                    ForEach(Agent.Provider.allCases) { Text($0.name).tag($0) }
                }
            }

            Section {
                LabeledContent {
                    Text(AppleAgent.unavailable == nil ? "On this iPhone" : "Off")
                        .foregroundStyle(AppleAgent.unavailable == nil ? palette.focus : palette.muted)
                } label: {
                    Label("Apple Intelligence", systemImage: "apple.intelligence")
                }
            } header: {
                Text("Apple")
            } footer: {
                Text(AppleAgent.unavailable ?? "Apple's on-device model, with Otter Mail's tools. Nothing leaves this iPhone, chats included. It asks before it changes or sends mail.")
            }

            Section {
                LabeledContent {
                    Text(statusText).foregroundStyle(statusColor)
                } label: {
                    Label("Hermes", systemImage: "cursorarrow")
                }
                if agent.hasKey && !agent.hermes.baseUrl.isEmpty {
                    LabeledContent("Server") {
                        Text(URL(string: agent.hermes.baseUrl)?.host() ?? agent.hermes.baseUrl)
                            .foregroundStyle(palette.muted)
                    }
                    if !agent.models.isEmpty {
                        Picker("Model", selection: $agent.hermes.model) {
                            Text("Hermes' default").tag("")
                            ForEach(agent.models.filter { !$0.slug.isEmpty }) { model in
                                Text(model.subProvider.map { "\(model.name) · \($0)" } ?? model.name).tag(model.slug)
                            }
                        }
                    }
                    if let model = agent.model, model.reasoning {
                        Picker("Reasoning", selection: $agent.hermes.reasoningEffort) {
                            ForEach(AgentView.efforts(model), id: \.0) { Text($0.1).tag($0.0) }
                        }
                    }
                    if let model = agent.model, model.fast {
                        Toggle("Fast", isOn: Binding(
                            get: { agent.hermes.serviceTier == "priority" },
                            set: { agent.hermes.serviceTier = $0 ? "priority" : "default" }
                        ))
                    }
                    Button("Disconnect", role: .destructive) { agent.disconnect() }
                } else {
                    TextField("https://hermes.example:8642", text: $url)
                        .keyboardType(.URL)
                        .textContentType(.URL)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                    SecureField("API key", text: $key)
                    Button(connecting ? "Connecting…" : "Connect") {
                        connecting = true
                        Task {
                            await agent.connect(url: url, key: key)
                            connecting = false
                        }
                    }
                    .disabled(url.isEmpty || key.isEmpty || connecting)
                }
            } header: {
                Text("Hermes")
            } footer: {
                Text("Your agent server, reached from every device. Chats live on it, so they're the same here, on the Mac and on the web. The key follows your Otter account, sealed.")
            }

            Section {
                macOnly("Codex", "chevron.left.forwardslash.chevron.right")
                macOnly("Claude", "asterisk")
            } header: {
                Text("On your Mac")
            } footer: {
                Text("Codex and Claude run on your Mac, where their command-line tools are. Use them in the Mac app.")
            }
        }
        .navigationTitle("Agents")
        .toolbarTitleDisplayMode(.inline)
        .onAppear { url = session.agent.hermes.baseUrl }
        .task { await session.agent.check() }
    }

    private func macOnly(_ name: String, _ symbol: String) -> some View {
        LabeledContent {
            Text("Mac app").foregroundStyle(palette.muted)
        } label: {
            Label(name, systemImage: symbol)
        }
    }

    private var statusText: String {
        switch session.agent.status {
        case .notConfigured: "Not connected"
        case .checking: "Checking…"
        case .ready: "Connected"
        case .failed: "Not answering"
        }
    }

    private var statusColor: Color {
        switch session.agent.status {
        case .ready: palette.focus
        case .failed: palette.error
        default: palette.muted
        }
    }
}
