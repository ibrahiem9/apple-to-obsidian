# Operation and recovery

## Configuration and schedules

The default local configuration is `~/Library/Application Support/apple-to-obsidian/config.json`. `--config FILE` or `APPLE_TO_OBSIDIAN_CONFIG` selects another file. Relative paths resolve against the configuration's directory. Output folders must stay inside the chosen vault.

`appleNotes.nightlyHour` defaults to 2 and `voiceMemos.nightlyHour` to 3 (local time, 0–23). Each job has its own lock and schedule state. LaunchAgents use calendar scheduling plus run-at-load; each importer suppresses repeated catch-up for its completed scheduling period. They run in the signed-in user's session, not before login. No jobs wake the Mac, and transcription runs one memo at a time. Initial setup only stages the jobs. Repeating setup does not unload jobs that are already active, so disable them before an upgrade.

Run `scripts/install-launchd` to restage after editing schedules. Run access checks again, and the short voice pilot/review when needed, before re-enabling. `--disable notes`, `--disable voice-memos`, and `--disable all` unload and persistently disable jobs without deleting outputs or state. The neutral labels are `org.appletoobsidian.apple-notes` and `org.appletoobsidian.voice-memos`.

## Errors and privacy

Use `scripts/run apple-notes-status`, `scripts/run voice-memos-status`, and `scripts/install-launchd --status`. Aggregate launchd logs are in the support directory's `logs` folder. Notes failures can retain private payload/error files in `apple-notes-runs`; these are for local diagnosis and must not be uploaded with a bug report. Never attach personal recordings, transcripts, catalogue snapshots, or local configuration to GitHub issues.

For a bug report, give the commit, macOS version, architecture, Node version, and Swift version. Include a short error after removing names, local paths, note titles, identifiers, and credentials. Reproduce with invented notes or generated audio when possible. Read the entire excerpt before posting it.

Lost permission, unreadable libraries, and unsupported catalogue schemas are failures. Incomplete downloads and changing recordings are deferred. Transcription failures retain the original audio for retry. A language detection failure supports a retry with an explicit supported language; mixed input remains unsupported.

The installer never grants Full Disk Access or Automation permissions programmatically. New installations and some app rebuilds require renewed manual approval. A stable bundle identifier does not guarantee that macOS will retain grants. Check access through launchd after rebuilding; ad-hoc signing is the default, with optional `APPLE_TO_OBSIDIAN_SIGN_IDENTITY` supplied locally for a persistent signing identity.

Whisper source and model checksums are pinned in the setup script. Setup records a local manifest with runtime/model hashes. Scheduled runs never call setup or download replacement assets. Missing assets require explicit repair. Apple's libraries are read-only sources: Voice Memos snapshots the catalogue/WAL and opens only its private copy; Notes is queried through Automation.

Normal transcription denies network access to converter and engine processes. Setup requires network access for dependencies, source, and model files. Full Disk Access gives the installed app broad local access; Notes Automation allows it to query Notes. Only grant these permissions to an app you built from source you trust. Exported content, original audio, and private diagnostics are sensitive local files. Backups and any vault sync need the same care as the original Apple libraries.

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

Disable jobs and wait for running imports to finish before rebuilding an existing installation. Back up the vault and stopped support directory. In the checkout, review the changes and update to your chosen commit or tag, then rerun setup with the same vault and any custom paths:

```sh
scripts/install-launchd --disable all
scripts/setup --vault "$HOME/Documents/Obsidian Vault"
scripts/install-launchd --check-access all
scripts/install-launchd --pilot --limit 1
```

Use your actual vault path. A custom installation also needs `--config` on scheduling commands and its original `--support-path` and `--app-path` on setup. Listen to the new sample, record `--review-voice-pilot`, and enable with `--enable all --accept-single-language-limitations` when satisfied. Notes alone can use `--enable notes` after its access check.

Setup preserves existing vault selection, schedules, and history; a different vault requires separate local configuration. It refreshes the Node executable path and replaces the locally built app. A new app, model, or configuration invalidates previous access/review receipts. The package does not modify or retire jobs from other projects. Check for duplicate older importers before enabling it on an already configured Mac.

To remove the installation:

1. Run `scripts/install-launchd --disable all` with the installation's configuration and wait for running imports to finish.
2. Remove `org.appletoobsidian.apple-notes.plist` and `org.appletoobsidian.voice-memos.plist` from `~/Library/LaunchAgents` if present.
3. Revoke Full Disk Access and turn off Notes Automation for the app in System Settings. Remove the installed app, normally `~/Applications/Apple to Obsidian.app`.
4. After backing it up, remove the support directory if you want to delete the model, state, private diagnostics, and logs. Remove the source checkout when you no longer need it.

Imported notes and audio remain in the vault. Retain a backup of durable history even if uninstalling; deleting it loses suppression of previously deleted notes. Deleting app files does not remove copies held by backups or vault-sync services.
