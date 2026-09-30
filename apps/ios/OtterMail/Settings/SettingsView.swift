import SwiftUI

/**
 * Settings, ChatGPT's sheet: who's signed in, then grouped rows. Everything
 * here is also in the Mac and web apps' settings, under the same names;
 * what only a computer has (menu bar, launch at login, the local agents,
 * keyboard shortcuts) stays there.
 */
struct SettingsView: View {
    @Environment(Preferences.self) private var preferences
    @Environment(Session.self) private var session
    @Environment(MailStore.self) private var store
    @Environment(\.palette) private var palette
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        @Bindable var preferences = preferences
        NavigationStack {
            SettingsForm {
                Section {
                    VStack(spacing: 8) {
                        ProfilePicture(url: session.user?.picture, size: 88)
                        Text(session.user.map { $0.name ?? $0.email } ?? "Demo mailbox")
                            .font(.title3.weight(.semibold))
                            .foregroundStyle(palette.text)
                        Text(session.user?.email ?? "Pretend mail, to try Otter Mail. Nothing here reaches Google.")
                            .font(.subheadline)
                            .foregroundStyle(palette.muted)
                            .multilineTextAlignment(.center)
                    }
                    .frame(maxWidth: .infinity)
                    .listRowBackground(Color.clear)
                }

                Section("Mail") {
                    NavigationLink {
                        MailboxesSettings()
                    } label: {
                        LabeledContent {
                            Text("\(store.shownMailboxes.count) on")
                        } label: {
                            Label("Mailboxes", systemImage: "tray.2")
                        }
                    }
                    Picker(selection: $preferences.notifications) {
                        ForEach(Preferences.Notifications.allCases) { Text($0.title).tag($0) }
                    } label: {
                        Label("Notifications", systemImage: "bell")
                    }
                    Picker(selection: $preferences.advance) {
                        ForEach(Preferences.Advance.allCases) { Text($0.title).tag($0) }
                    } label: {
                        Label("After archive", systemImage: "arrow.turn.down.right")
                    }
                }

                Section {
                    NavigationLink {
                        LanguagesSettings()
                    } label: {
                        LabeledContent {
                            Text(languageSummary)
                        } label: {
                            Label("Languages I read", systemImage: "character.bubble")
                        }
                    }
                    Toggle(isOn: $preferences.autoTranslate) {
                        Label("Translate automatically", systemImage: "translate")
                    }
                } header: {
                    Text("Translation")
                } footer: {
                    Text("Mail in other languages is translated on this iPhone, by Apple's Translation.")
                }

                Section("Agents") {
                    NavigationLink {
                        AgentSettings()
                    } label: {
                        LabeledContent {
                            Text(session.agent.current == .ready ? session.agent.provider.name : "Off")
                        } label: {
                            Label("Agents", systemImage: "cursorarrow")
                        }
                    }
                }

                Section("Appearance") {
                    Picker(selection: $preferences.scheme) {
                        ForEach(Preferences.Scheme.allCases) { Text($0.title).tag($0) }
                    } label: {
                        Label("Appearance", systemImage: "circle.lefthalf.filled")
                    }
                    NavigationLink {
                        ThemeSettings()
                    } label: {
                        LabeledContent {
                            Text(themeSummary)
                        } label: {
                            Label("Theme", systemImage: "paintpalette")
                        }
                    }
                }

                Section("Account") {
                    if session.user != nil {
                        NavigationLink {
                            AccountSettings()
                        } label: {
                            Label("Otter account", systemImage: "person.crop.circle")
                        }
                    } else {
                        Button {
                            dismiss()
                            session.leaveDemo()
                        } label: {
                            Label("Sign in with Google", systemImage: "person.crop.circle.badge.plus")
                        }
                    }
                    LabeledContent {
                        Text(Bundle.main.version)
                    } label: {
                        Label("Version", systemImage: "info.circle")
                    }
                }
            }
            .foregroundStyle(palette.text)
            .navigationTitle("Settings")
            .onChange(of: preferences.notifications) { _, mode in
                if mode != .off { Task { await session.requestNotifications() } }
            }
            .toolbarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close", systemImage: "xmark") { dismiss() }
                }
            }
        }
    }

    private var languageSummary: String {
        let names = preferences.effectiveReadLanguages.compactMap { Locale.current.localizedString(forLanguageCode: $0) }
        return names.count > 2 ? "\(names[0]) +\(names.count - 1)" : names.joined(separator: ", ")
    }

    private var themeSummary: String {
        let light = Theme.named(preferences.lightTheme)?.label ?? ""
        let dark = Theme.named(preferences.darkTheme)?.label ?? ""
        return light == dark ? light : "\(light), \(dark)"
    }
}

/** Settings' grouped list, on the theme's canvas with its rows as cards (ChatGPT's settings). */
struct SettingsForm<Content: View>: View {
    @Environment(\.palette) private var palette
    @ViewBuilder var content: Content

    var body: some View {
        List {
            content.listRowBackground(palette.card)
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        .background(palette.canvas)
    }
}
