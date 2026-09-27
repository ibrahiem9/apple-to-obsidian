import Foundation
import AudioCommon
import OmnilingualASR

enum PilotFailure: Error { case arguments, missingAssets, emptyAudio }

@main
struct VoiceOmnilingualPilot {
    static func option(_ name: String) -> String? {
        guard let index = CommandLine.arguments.firstIndex(of: name), index + 1 < CommandLine.arguments.count else { return nil }
        return CommandLine.arguments[index + 1]
    }

    static func main() async {
        do {
            guard let input = option("--input"), let output = option("--output"),
                  let modelPath = option("--model-dir") ?? ProcessInfo.processInfo.environment["VOICE_OMNILINGUAL_MODEL_DIR"],
                  input.hasPrefix("/"), output.hasPrefix("/"), modelPath.hasPrefix("/") else { throw PilotFailure.arguments }
            let modelDirectory = URL(fileURLWithPath: modelPath, isDirectory: true)
            for name in ["config.json", "tokenizer.model", "omnilingual-ctc-300m-int8.mlmodelc/weights/weight.bin"] {
                guard FileManager.default.fileExists(atPath: modelDirectory.appendingPathComponent(name).path) else { throw PilotFailure.missingAssets }
            }
            // offlineMode is essential: no downloader or Hugging Face request during inference.
            let model = try await OmnilingualASRModel.fromPretrained(cacheDir: modelDirectory, offlineMode: true)
            let reader = try AudioFileChunkReader(url: URL(fileURLWithPath: input), options: .init(
                targetSampleRate: model.config.sampleRate,
                chunkDuration: model.config.maxAudioSeconds,
                channelSelection: .mixAll,
                resampleQuality: .mastering))
            var parts: [String] = []
            var frames = 0
            while let chunk = try reader.readChunk() {
                frames += chunk.samples.count
                let text = try autoreleasepool {
                    try model.transcribeAudio(chunk.samples, sampleRate: chunk.sampleRate, language: nil)
                }
                if !text.isEmpty { parts.append(text) }
            }
            guard frames > 0 else { throw PilotFailure.emptyAudio }
            try parts.joined(separator: "\n").write(toFile: output, atomically: true, encoding: .utf8)
            try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: output)
        } catch {
            // Upstream errors may contain local paths. Never print the error or speech text.
            FileHandle.standardError.write(Data("Local Omnilingual pilot failed; check arguments and preloaded model assets.\n".utf8))
            exit(1)
        }
    }
}
