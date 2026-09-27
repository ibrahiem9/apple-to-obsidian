import Foundation
import SQLite3
import CryptoKit
import AVFoundation

struct Recording: Codable, Equatable {
    let id: String
    let title: String
    let createdAt: String
    let durationSeconds: Double
    let audioPath: String
    let ready: Bool
    let deferredReason: String?
}

/// Copy the database and committed WAL together, then let SQLite recover only
/// the private copy. No SQLite connection ever touches Apple's source files.
final class Catalogue {
    let root: URL
    let scratch: URL
    let database: OpaquePointer

    init(library: String) throws {
        root = URL(fileURLWithPath: library, isDirectory: true).resolvingSymlinksInPath()
        scratch = FileManager.default.temporaryDirectory.appendingPathComponent("voice-catalogue-" + UUID().uuidString)
        try FileManager.default.createDirectory(at: scratch, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        var opened: OpaquePointer?
        do {
            let names = try FileManager.default.contentsOfDirectory(atPath: root.path)
            guard names.contains("CloudRecordings.db") else { throw ExportError.message("Unrecognized library: CloudRecordings.db is missing") }
            let source = root.appendingPathComponent("CloudRecordings.db")
            let wal = root.appendingPathComponent("CloudRecordings.db-wal")
            var copied = false
            for _ in 0..<3 {
                let before = try Self.fingerprint([source, wal])
                for url in [source, wal] {
                    let target = scratch.appendingPathComponent(url.lastPathComponent)
                    try? FileManager.default.removeItem(at: target)
                    if FileManager.default.fileExists(atPath: url.path) { try FileManager.default.copyItem(at: url, to: target) }
                }
                let after = try Self.fingerprint([source, wal])
                let snapshot = try Self.fingerprint([scratch.appendingPathComponent(source.lastPathComponent), scratch.appendingPathComponent(wal.lastPathComponent)])
                if before == after && before == snapshot { copied = true; break }
                Thread.sleep(forTimeInterval: 0.2)
            }
            guard copied else { throw ExportError.message("Voice Memos catalogue is changing; retry after recording or synchronization completes") }
            let status = sqlite3_open_v2(scratch.appendingPathComponent("CloudRecordings.db").path, &opened, SQLITE_OPEN_READWRITE, nil)
            guard status == SQLITE_OK, let handle = opened else { throw ExportError.message("Cannot open the private catalogue snapshot") }
            database = handle
            sqlite3_busy_timeout(handle, 1000)
            guard try rows("PRAGMA quick_check").first?.first?.value as? String == "ok" else { throw ExportError.message("Voice Memos catalogue snapshot failed its integrity check") }
        } catch {
            if let opened { sqlite3_close(opened) }
            try? FileManager.default.removeItem(at: scratch)
            throw error
        }
    }
    deinit { sqlite3_close(database); try? FileManager.default.removeItem(at: scratch) }

    static func fingerprint(_ urls: [URL]) throws -> [String] {
        try urls.map { url in
            guard FileManager.default.fileExists(atPath: url.path) else { return "missing" }
            return SHA256.hash(data: try Data(contentsOf: url)).map { String(format: "%02x", $0) }.joined()
        }
    }

    func rows(_ query: String, bind: String? = nil) throws -> [[String: Any]] {
        var statement: OpaquePointer?
        guard sqlite3_prepare_v2(database, query, -1, &statement, nil) == SQLITE_OK else { throw ExportError.message("Unsupported Voice Memos catalogue schema") }
        defer { sqlite3_finalize(statement) }
        if let bind { _ = bind.withCString { sqlite3_bind_text(statement, 1, $0, -1, unsafeBitCast(-1, to: sqlite3_destructor_type.self)) } }
        var result: [[String: Any]] = []
        var step = sqlite3_step(statement)
        while step == SQLITE_ROW {
            var row: [String: Any] = [:]
            for column in 0..<sqlite3_column_count(statement) {
                let name = String(cString: sqlite3_column_name(statement, column))
                switch sqlite3_column_type(statement, column) {
                case SQLITE_INTEGER: row[name] = sqlite3_column_int64(statement, column)
                case SQLITE_FLOAT: row[name] = sqlite3_column_double(statement, column)
                case SQLITE_TEXT: row[name] = String(cString: sqlite3_column_text(statement, column))
                case SQLITE_BLOB:
                    if let bytes = sqlite3_column_blob(statement, column) { row[name] = Data(bytes: bytes, count: Int(sqlite3_column_bytes(statement, column))) }
                default: break
                }
            }
            result.append(row)
            step = sqlite3_step(statement)
        }
        guard step == SQLITE_DONE else { throw ExportError.message("Cannot read the private catalogue snapshot") }
        return result
    }

    func diagnostics() throws -> [String: Any] {
        let schemas = try rows("SELECT name, sql FROM sqlite_schema WHERE type='table' ORDER BY name")
        let records = try rows("SELECT * FROM ZCLOUDRECORDING")
        var paths: [String: Int] = [:]
        var titles: [String: Int] = [:]
        var blobKeys: Set<String> = []
        var audioStates: [String: Int] = [:]
        var blobs: [String: Int] = [:]
        for row in records {
            let path = row["ZPATH"] as? String ?? ""
            let category: String
            if path.isEmpty { category = "empty" }
            else if path.hasPrefix("/") { category = "absolute" }
            else if path.hasPrefix("file:") { category = "fileURL" }
            else if path.contains("/") { category = "relativeNested" }
            else { category = "basename" }
            paths[category, default: 0] += 1
            let candidate = path.hasPrefix("/") ? URL(fileURLWithPath: path) : root.appendingPathComponent(path)
            if !path.isEmpty && FileManager.default.fileExists(atPath: candidate.path) { paths["directLinkExists", default: 0] += 1 }
            if !path.isEmpty, let duration = row["ZDURATION"] as? Double {
                let state = (try? Self.audioState(candidate, expectedDuration: duration)) ?? "ready"
                let flags = (row["ZFLAGS"] as? Int64) ?? -1
                audioStates["flags=\(flags):\(state)", default: 0] += 1
                if let file = try? AVAudioFile(forReading: candidate) {
                    let actual = Double(file.length) / file.processingFormat.sampleRate
                    let local = (row["ZLOCALDURATION"] as? Double) ?? 0
                    audioStates["decodedMatchesCloud=\(abs(actual-duration)<0.25):decodedMatchesLocal=\(abs(actual-local)<0.25)", default: 0] += 1
                }
            }
            for column in ["ZCUSTOMLABEL", "ZENCRYPTEDTITLE", "ZUNIQUEID"] {
                if let value = row[column] as? String, !value.isEmpty { titles[column, default: 0] += 1 }
            }
            if (row["ZCUSTOMLABEL"] as? String) == (row["ZENCRYPTEDTITLE"] as? String) { titles["titleColumnsEqual", default: 0] += 1 }
            for column in ["ZAUDIOFUTURE", "ZVERSIONEDAUDIOFUTURE"] {
                if let data = row[column] as? Data {
                    let category = data.starts(with: Data("bplist".utf8)) ? "binary-plist" : "firstByte=\(data.first ?? 0):size=\(data.count)"
                    blobs[column + ":" + category, default: 0] += 1
                    if let value = try? PropertyListSerialization.propertyList(from: data, format: nil) as? [String: Any] {
                        blobKeys.formUnion(value.keys.map { column + ":" + $0 })
                    }
                }
            }
        }
        let flags = try rows("SELECT ZFLAGS AS flags, ZSHAREDFLAGS AS sharedFlags, ZAUDIOFUTUREFLAGS AS audioFutureFlags, COUNT(*) AS count, SUM(ZEVICTIONDATE IS NOT NULL) AS evictionDatePresent, SUM(ABS(ZDURATION-ZLOCALDURATION)<0.1) AS localDurationMatches, SUM(ZDURATION>0) AS positiveDuration FROM ZCLOUDRECORDING GROUP BY ZFLAGS,ZSHAREDFLAGS,ZAUDIOFUTUREFLAGS")
        let validated = try? inventory()
        let adapterCounts: [String: Any] = validated.map { ["active": $0.count, "ready": $0.filter(\.ready).count, "deferred": $0.filter { !$0.ready }.count] } ?? [:]
        return ["schemaVersion": 1, "inspectionOnly": true, "catalogueRecognized": validated != nil, "snapshot": "verified-db-and-wal-copy", "catalogues": [["filename": "CloudRecordings.db", "tables": schemas]], "aggregate": ["recordings": records.count, "adapterCounts": adapterCounts, "flags": flags, "pathKinds": paths, "nonemptyMetadata": titles, "audioFutureTopLevelKeys": blobKeys.sorted(), "audioStates": audioStates, "audioFutureFormats": blobs]]
    }

    func recording(from row: [String: Any], deferred initialReason: String?) throws -> Recording {
        guard let id = row["ZUNIQUEID"] as? String, !id.isEmpty,
              let date = row["ZDATE"] as? NSNumber,
              let durationValue = row["ZDURATION"] as? NSNumber else {
            throw ExportError.message("Voice Memos catalogue contains incomplete recording metadata")
        }
        let duration = durationValue.doubleValue
        let created = Date(timeIntervalSinceReferenceDate: date.doubleValue)
        guard duration.isFinite && duration >= 0 && created.timeIntervalSince1970 >= 0 && created <= Date().addingTimeInterval(86400) else {
            throw ExportError.message("Voice Memos catalogue contains invalid recording metadata")
        }
        // Verified against RCCloudRecording._localTitleForWillSave with
        // conflicting synthetic values: encryptedTitle wins when non-nil.
        let sourceTitle = (row["ZENCRYPTEDTITLE"] as? String) ?? (row["ZCUSTOMLABEL"] as? String)
        let title = sourceTitle.flatMap { $0.isEmpty ? nil : $0 } ?? "Voice Memo"
        let path = row["ZPATH"] as? String ?? ""
        var reason = initialReason
        var audioPath = ""
        // Only basename paths have been observed and validated. A new path
        // representation is deferred, never guessed or followed outside the library.
        if !path.isEmpty && path == URL(fileURLWithPath: path).lastPathComponent && path != "." && path != ".." {
            let url = root.appendingPathComponent(path)
            if url.resolvingSymlinksInPath().deletingLastPathComponent() == root {
                audioPath = url.path
                if reason == nil {
                    do { reason = try Self.audioState(url, expectedDuration: duration) }
                    catch { reason = "audio-unreadable" }
                }
            } else { reason = reason ?? "audio-path-outside-library" }
        } else { reason = reason ?? "audio-path-unavailable" }
        if let local = row["ZLOCALDURATION"] as? NSNumber,
           abs(local.doubleValue - duration) > max(0.25, duration * 0.001) { reason = reason ?? "local-duration-incomplete" }
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return Recording(id: id, title: title, createdAt: formatter.string(from: created), durationSeconds: duration, audioPath: audioPath, ready: reason == nil, deferredReason: reason)
    }

    func inventory() throws -> [Recording] {
        let required: Set<String> = ["ZUNIQUEID", "ZFLAGS", "ZDATE", "ZDURATION", "ZLOCALDURATION", "ZPATH", "ZENCRYPTEDTITLE", "ZCUSTOMLABEL", "ZEVICTIONDATE"]
        let columns = Set(try rows("PRAGMA table_info(ZCLOUDRECORDING)").compactMap { $0["name"] as? String })
        guard required.isSubset(of: columns) else { throw ExportError.message("Unsupported Voice Memos catalogue schema; run the native inspect command after updating the adapter") }
        let source = try rows("SELECT * FROM ZCLOUDRECORDING ORDER BY ZDATE, ZUNIQUEID")
        var seen: Set<String> = []
        var result: [Recording] = []
        for row in source {
            guard let id = row["ZUNIQUEID"] as? String, !id.isEmpty, seen.insert(id).inserted else {
                throw ExportError.message("Voice Memos catalogue has missing or duplicate recording identities")
            }
            // Apple's deletionDate getter aliases evictionDate. Deleted rows
            // are excluded, including audio retained in Recently Deleted.
            if row["ZEVICTIONDATE"] != nil { continue }
            guard let flags = row["ZFLAGS"] as? Int64 else { throw ExportError.message("Voice Memos catalogue has invalid recording flags") }
            // Verified from the installed framework using synthetic in-memory
            // entities; unrecognized bits must not silently imply readiness.
            let known: Int64 = 2 | 4 | 8 | 64 | 256 | 512 | 1024 | 2048 | 4096
            let reason: String?
            if flags & ~known != 0 { reason = "unrecognized-recording-flags" }
            else if flags & 2 != 0 { reason = "audio-needs-download" }
            else if flags & 256 != 0 { reason = "audio-needs-export" }
            else if flags & 4 == 0 { reason = "recording-not-playable" }
            else { reason = nil }
            result.append(try recording(from: row, deferred: reason))
        }
        return result
    }

    static func audioState(_ url: URL, expectedDuration: Double) throws -> String? {
        let keys: Set<URLResourceKey> = [.isRegularFileKey, .isSymbolicLinkKey, .fileSizeKey, .contentModificationDateKey, .isUbiquitousItemKey, .ubiquitousItemDownloadingStatusKey]
        guard FileManager.default.fileExists(atPath: url.path) else { return "audio-not-downloaded" }
        let values = try url.resourceValues(forKeys: keys)
        guard values.isRegularFile == true, values.isSymbolicLink != true else { return "audio-not-regular-file" }
        if values.isUbiquitousItem == true && values.ubiquitousItemDownloadingStatus != .current { return "audio-not-downloaded" }
        guard let size = values.fileSize, size > 0 else { return "audio-empty" }
        guard let modified = values.contentModificationDate, Date().timeIntervalSince(modified) >= 120 else { return "audio-recently-changing" }
        do {
            let audio = try AVAudioFile(forReading: url)
            let duration = Double(audio.length) / audio.processingFormat.sampleRate
            guard audio.length > 0 && abs(duration - expectedDuration) <= max(0.25, expectedDuration * 0.001) else { return "audio-duration-incomplete" }
            // Decode the final frames to detect a file with valid headers but a
            // truncated or unavailable tail, without changing the original.
            audio.framePosition = max(0, audio.length - 1024)
            guard let buffer = AVAudioPCMBuffer(pcmFormat: audio.processingFormat, frameCapacity: 1024) else { return "audio-format-unreadable" }
            try audio.read(into: buffer)
            guard buffer.frameLength > 0 else { return "audio-tail-unreadable" }
        } catch { return "audio-unreadable" }
        return nil
    }

    static func digestFile(_ url: URL) throws -> String {
        let handle = try FileHandle(forReadingFrom: url)
        defer { try? handle.close() }
        var hash = SHA256()
        while let block = try handle.read(upToCount: 1024 * 1024), !block.isEmpty { hash.update(data: block) }
        return hash.finalize().map { String(format: "%02x", $0) }.joined()
    }

    func copy(_ recording: Recording, output: URL, revalidate: (Catalogue) throws -> Recording?) throws -> [String: Any] {
        guard recording.ready else { throw ExportError.deferred("Recording is not ready; retry after synchronization completes") }
        guard !output.resolvingSymlinksInPath().path.hasPrefix(root.path + "/") else { throw ExportError.message("Export destination must be outside the Voice Memos library") }
        guard !FileManager.default.fileExists(atPath: output.path) else { throw ExportError.message("Export destination already exists; refusing to overwrite it") }
        var isDirectory: ObjCBool = false
        guard FileManager.default.fileExists(atPath: output.deletingLastPathComponent().path, isDirectory: &isDirectory), isDirectory.boolValue else { throw ExportError.message("Export destination directory is missing") }
        let source = URL(fileURLWithPath: recording.audioPath)
        let temporary = output.deletingLastPathComponent().appendingPathComponent(".voice-copy-" + UUID().uuidString + "." + source.pathExtension)
        defer { try? FileManager.default.removeItem(at: temporary) }
        do {
            let beforeAttributes = try FileManager.default.attributesOfItem(atPath: source.path)
            let beforeHash = try Self.digestFile(source)
            try FileManager.default.copyItem(at: source, to: temporary)
            try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: temporary.path)
            let copiedHash = try Self.digestFile(temporary)
            let afterHash = try Self.digestFile(source)
            let afterAttributes = try FileManager.default.attributesOfItem(atPath: source.path)
            guard beforeHash == copiedHash, copiedHash == afterHash,
                  (beforeAttributes[.modificationDate] as? Date) == (afterAttributes[.modificationDate] as? Date),
                  (beforeAttributes[.systemFileNumber] as? NSNumber) == (afterAttributes[.systemFileNumber] as? NSNumber),
                  try Self.audioState(temporary, expectedDuration: recording.durationSeconds) == nil else {
                throw ExportError.deferred("Recording changed or was incomplete while copying; retry next run")
            }
            let latest = try Catalogue(library: root.path)
            guard let current = try revalidate(latest), current == recording else {
                throw ExportError.deferred("Recording metadata changed while copying; retry next run")
            }
            let handle = try FileHandle(forWritingTo: temporary)
            try handle.synchronize()
            try handle.close()
            // Hard-link publication is atomic and exclusive. The destination
            // staging file is on the same volume, even for an external vault.
            guard link(temporary.path, output.path) == 0 else { throw ExportError.message("Cannot publish original audio without overwriting an existing file") }
            let directory = open(output.deletingLastPathComponent().path, O_RDONLY)
            if directory >= 0 { _ = fsync(directory); close(directory) }
            let encoded = try JSONEncoder().encode(current)
            return ["recording": try JSONSerialization.jsonObject(with: encoded), "sha256": copiedHash]
        } catch let error as ExportError { throw error }
        catch {
            let cocoa = error as NSError
            if cocoa.domain == NSCocoaErrorDomain && [NSFileReadNoSuchFileError, NSFileNoSuchFileError].contains(cocoa.code) {
                throw ExportError.deferred("Original audio became unavailable during the copy; retry next run")
            }
            throw ExportError.message("Could not preserve original audio. Check destination permissions and available disk space")
        }
    }
}
