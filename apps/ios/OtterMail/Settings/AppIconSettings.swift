import SwiftUI

/** UIKit remembers the icon on this device; it doesn't follow the color theme. */
struct AppIconSettings: View {
    @Environment(\.palette) private var palette
    @Environment(\.scenePhase) private var scenePhase
    @State private var selected = currentIcon
    @State private var changing = false
    @State private var error: String?

    private static var currentIcon: String {
        UIApplication.shared.alternateIconName?.replacingOccurrences(of: "AppIcon-", with: "") ?? "codex"
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                Text("Choose an icon for this iPhone, independently of your theme.")
                    .font(.subheadline)
                    .foregroundStyle(palette.muted)
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 90), spacing: 12)], spacing: 12) {
                    ForEach(Theme.all) { theme in
                        Button {
                            Task { await pick(theme.id) }
                        } label: {
                            VStack(spacing: 10) {
                                Image("AppIconPreview-\(theme.id)")
                                    .resizable()
                                    .frame(width: 64, height: 64)
                                    .clipShape(.rect(cornerRadius: 15))
                                Text(theme.label)
                                    .font(.caption)
                                    .foregroundStyle(palette.text)
                            }
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 16)
                            .background(selected == theme.id ? palette.card : .clear, in: .rect(cornerRadius: 16))
                            .overlay(alignment: .topTrailing) {
                                if selected == theme.id {
                                    Image(systemName: "checkmark.circle.fill")
                                        .foregroundStyle(palette.focus)
                                        .padding(6)
                                }
                            }
                        }
                        .buttonStyle(.plain)
                        .disabled(changing)
                        .accessibilityLabel("\(theme.label) app icon")
                        .accessibilityAddTraits(selected == theme.id ? .isSelected : [])
                    }
                }
            }
            .padding(20)
        }
        .background(palette.canvas)
        .navigationTitle("App icon")
        .toolbarTitleDisplayMode(.inline)
        .onAppear { selected = Self.currentIcon }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { selected = Self.currentIcon }
        }
        .alert("Couldn't change the app icon", isPresented: Binding(
            get: { error != nil }, set: { if !$0 { error = nil } }
        )) {
            Button("OK") { error = nil }
        } message: {
            Text(error ?? "")
        }
    }

    @MainActor
    private func pick(_ id: String) async {
        guard !changing, id != Self.currentIcon else { return }
        changing = true
        defer { changing = false }
        do {
            try await UIApplication.shared.setAlternateIconName(id == "codex" ? nil : "AppIcon-\(id)")
            selected = Self.currentIcon
        } catch {
            self.error = error.localizedDescription
        }
    }
}
