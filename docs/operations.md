# Operation and recovery

## Configuration and schedules

The default local configuration is `~/Library/Application Support/apple-to-obsidian/config.json`. `--config FILE` or `APPLE_TO_OBSIDIAN_CONFIG` selects another file. Relative paths resolve against the configuration's directory. Output folders must stay inside the chosen vault.

`appleNotes.nightlyHour` defaults to 2 and `voiceMemos.nightlyHour` to 3 (local time, 0–23). Each job has its own lock and schedule state. LaunchAgents use calendar scheduling plus run-at-load; each importer suppresses repeated catch-up for its completed scheduling period. They run in the signed-in user's session, not before login. No jobs wake the Mac, and transcription runs one memo at a time.

Run `scripts/install-launchd` to restage after editing schedules. Run access checks again, and the short voice pilot/review when needed, before re-enabling. `--disable notes`, `--disable voice-memos`, and `--disable all` unload and persistently disable jobs without deleting outputs or state. The neutral labels are `org.appletoobsidian.apple-notes` and `org.appletoobsidian.voice-memos`.

## Errors and privacy

Use `scripts/run apple-notes-status`, `scripts/run voice-memos-status`, and `scripts/install-launchd --status`. Aggregate launchd logs are in the support directory's `logs` folder. Notes failures can retain private payload/error files in `apple-notes-runs`; these are for local diagnosis and must not be uploaded with a bug report. Never attach personal recordings, transcripts, catalogue snapshots, or local configuration to GitHub issues.

Lost permission, unreadable libraries, and unsupported catalogue schemas are failures. Incomplete downloads and changing recordings are deferred. Transcription failures retain the original audio for retry. A language detection failure supports a retry with an explicit supported language; mixed input remains unsupported.

The installer never grants Full Disk Access or Automation permissions programmatically. New installations and some app rebuilds require renewed manual approval. A stable bundle identifier does not guarantee that macOS will retain grants. Check access through launchd after rebuilding; ad-hoc signing is the default, with optional `APPLE_TO_OBSIDIAN_SIGN_IDENTITY` supplied locally for a persistent signing identity.

Whisper source and model checksums are pinned in the setup script. Setup records a local manifest with runtime/model hashes. Scheduled runs never call setup or download replacement assets. Missing assets require explicit repair. Apple's libraries are read-only sources: Voice Memos snapshots the catalogue/WAL and opens only its private copy; Notes is queried through Automation.

## Backups and another Mac

Back up the vault **and the support directory's durable state**. Voice Memos history records imports and deletion suppression; it cannot be reconstructed from the current vault because deleted notes leave no marker. Never delete history to repair an import.

To move an existing installation:

1. Disable both jobs on the old Mac and wait for any in-progress work to finish.
2. Back up/copy the vault and state databases while stopped. Do not copy running SQLite files without their associated journals; taking the entire stopped support directory preserves them.
3. Install on the new Mac with its vault path. Restore the history and Notes schedule database before enabling anything. Use the new Mac's configuration and app, not the old absolute configuration paths or permission receipts.
4. Grant this Mac's permissions and run its access checks. Existing Voice Memos IDs in the vault with missing/empty history block import and instruct you to restore history.
5. For a previously retained attachment whose old path is unavailable, the importer can find the expected content-addressed copy in the new vault, verify its hash, and update the restored history. It does not reconstruct IDs or deletion history.
6. Perform a short pilot with a new single-language memo, record the review, and enable the jobs. Keep only one Mac actively importing into the same synchronized vault.

A missing or modified retained attachment is an error. Keep original import-ID metadata when moving or renaming notes. Explicit retries create separate results; suppressing deleted notes remains independent of the recording's availability in Apple's app.

## Updating or removing

Disable jobs before rebuilding an existing installation. Rerun setup, recheck permissions, and review a short sample before enabling. Setup preserves existing vault selection, schedules, and history; a different vault requires separate local configuration. The package does not modify or retire jobs from other projects. Check for duplicate older importers yourself before enabling it on an already configured Mac.

To stop using the package, disable both jobs first. Removal of the app or checkout does not delete notes/audio. Retain a backup of durable history even if uninstalling; deleting it loses suppression of previously deleted notes.
