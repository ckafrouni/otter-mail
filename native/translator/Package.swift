// swift-tools-version: 6.0
import PackageDescription

let package = Package(
  name: "translator",
  platforms: [.macOS(.v13)],
  targets: [
    .executableTarget(name: "translator")
  ]
)
