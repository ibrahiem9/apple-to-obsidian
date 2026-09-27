import Foundation
import SQLite3

enum ExportError: LocalizedError {
    case message(String)
    case deferred(String)
    var errorDescription: String? {
        switch self { case .message(let text), .deferred(let text): return text }
    }
}

// The native parent remains alive while Node runs. Replacing it with exec would
// remove the app responsible for scheduled library access from the process tree.
@main
struct VoiceMemos {
    static func main() {
        do {
            let arguments = Array(CommandLine.arguments.dropFirst())
            guard let command = arguments.first else { throw ExportError.message("Expected inspect, inventory, copy, or run") }
            if command == "run" {
                let node = try absoluteOption("--node", arguments)
                let cli = try absoluteOption("--cli", arguments)
                let config = try absoluteOption("--config", arguments)
                var remaining = Array(arguments.dropFirst())
                for key in ["--node", "--cli", "--config"] {
                    guard let index = remaining.firstIndex(of: key), remaining.indices.contains(index + 1) else {
                        throw ExportError.message("Missing \(key)")
                    }
                    remaining.removeSubrange(index...index + 1)
                }
                if remaining.isEmpty { remaining = ["voice-memos-sync"] }
                guard ["voice-memos-sync", "voice-memos-check", "voice-memos-status", "apple-notes-sync", "apple-notes-check", "apple-notes-status"].contains(remaining[0]) else {
                    throw ExportError.message("The dedicated launcher permits only Apple Notes and Voice Memos import commands")
                }
                let process = Process()
                process.executableURL = URL(fileURLWithPath: node)
                process.arguments = [cli, "--config", config] + remaining
                try process.run()
                process.waitUntilExit()
                if process.terminationStatus != 0 && ["voice-memos-sync", "apple-notes-sync"].contains(remaining.first ?? "") && remaining.contains("--scheduled") {
                    notifyFailure()
                }
                exit(process.terminationStatus)
            }
            guard ["inspect", "inventory", "copy"].contains(command) else { throw ExportError.message("Unknown command: \(command)") }
            let library = try absoluteOption("--library", arguments)
            let catalogue = try Catalogue(library: library)
            if command == "inspect" {
                try emit(catalogue.diagnostics())
                return
            }
            let recordings = try catalogue.inventory()
            if command == "inventory" {
                let encoded = try JSONEncoder().encode(recordings)
                try emit(["schemaVersion": 1, "catalogueRecognized": true, "recordings": try JSONSerialization.jsonObject(with: encoded)])
            } else {
                guard let index = arguments.firstIndex(of: "--id"), arguments.indices.contains(index + 1), !arguments[index + 1].isEmpty else {
                    throw ExportError.message("--id requires a recording identifier")
                }
                let id = arguments[index + 1]
                guard let recording = recordings.first(where: { $0.id == id }) else { throw ExportError.deferred("Recording is no longer active in the catalogue") }
                let output = URL(fileURLWithPath: try absoluteOption("--output", arguments))
                try emit(catalogue.copy(recording, output: output) { latest in
                    try latest.inventory().first(where: { $0.id == id })
                })
            }
        } catch {
            let message = (error as? ExportError)?.localizedDescription ?? "Voice Memos operation failed. Check Full Disk Access for Apple to Obsidian.app, library access, and available disk space."
            FileHandle.standardError.write(Data("\(message)\n".utf8))
            if case ExportError.deferred = error { exit(75) }
            exit(1)
        }
    }

    static func absoluteOption(_ name: String, _ arguments: [String]) throws -> String {
        guard let index = arguments.firstIndex(of: name), arguments.indices.contains(index + 1), arguments[index + 1].hasPrefix("/") else {
            throw ExportError.message("\(name) requires an absolute path")
        }
        return arguments[index + 1]
    }

    static func emit(_ value: Any) throws {
        let data = try JSONSerialization.data(withJSONObject: value, options: [.sortedKeys])
        FileHandle.standardOutput.write(data)
        FileHandle.standardOutput.write(Data("\n".utf8))
    }

    static func notifyFailure() {
        let preferences = UserDefaults(suiteName: "org.appletoobsidian.bridge")!
        let today = Calendar.current.startOfDay(for: Date())
        if let last = preferences.object(forKey: "lastFailureNotification") as? Date, last >= today { return }
        let notifier = Process()
        notifier.executableURL = URL(fileURLWithPath: "/usr/bin/osascript")
        notifier.arguments = ["-e", "display notification \"The overnight import needs attention. Run the matching apple-notes-status or voice-memos-status command.\" with title \"Apple to Obsidian\""]
        notifier.standardOutput = FileHandle.nullDevice
        notifier.standardError = FileHandle.nullDevice
        do {
            try notifier.run()
            notifier.waitUntilExit()
            if notifier.terminationStatus == 0 { preferences.set(today, forKey: "lastFailureNotification") }
        } catch { /* Notification failure must not mask the import failure. */ }
    }

}
