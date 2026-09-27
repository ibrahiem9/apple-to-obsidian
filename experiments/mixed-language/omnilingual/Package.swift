// swift-tools-version: 5.10
import PackageDescription

let package = Package(
    name: "VoiceMemosOmnilingualPilot",
    platforms: [.macOS("15.0")],
    products: [.executable(name: "voice-omnilingual-pilot", targets: ["VoiceOmnilingualPilot"])],
    dependencies: [
        .package(url: "https://github.com/soniqo/speech-swift.git", revision: "cb4ed4cded5c1207bb0727e91073d7c83df90a21")
    ],
    targets: [.executableTarget(name: "VoiceOmnilingualPilot", dependencies: [
        .product(name: "OmnilingualASR", package: "speech-swift"),
        .product(name: "AudioCommon", package: "speech-swift")
    ])]
)
