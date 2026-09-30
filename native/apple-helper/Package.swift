// swift-tools-version: 6.0
import PackageDescription

let package = Package(
  name: "apple-helper",
  platforms: [.macOS(.v13)],
  targets: [
    .executableTarget(name: "apple-helper")
  ]
)
