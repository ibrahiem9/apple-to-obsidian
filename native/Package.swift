// swift-tools-version: 6.2
import PackageDescription

let package = Package(
    name: "AppleToObsidian",
    platforms: [.macOS(.v26)],
    products: [.executable(name: "voice-memos", targets: ["VoiceMemos"])],
    targets: [.executableTarget(name: "VoiceMemos", linkerSettings: [.linkedLibrary("sqlite3")])]
)
