# Apple to Obsidian

Local Apple Notes exports and Voice Memos transcripts for Obsidian on Apple Silicon Macs. This is a personal project distributed as source under the [MIT license](LICENSE). You build and install it on your own Mac. There are no prebuilt or notarized downloads, and Apple Developer enrollment is not required.

Two independent macOS LaunchAgents run Notes at **2 AM** and Voice Memos at **3 AM**, with catch-up after sleep or login. Setup leaves both schedules disabled until you check permissions and enable them. No wake settings are changed.

Voice Memos uses Whisper Large v3 locally, with one language per recording: **English, Arabic, or Urdu**. It preserves the original language and script. There is no cloud inference, translation, summarization, or rewriting. Mixed-language recordings are unsupported and are not reliably detected. See the [future-feature roadmap](docs/roadmap.md).

**Limits:** automatic language detection can be wrong, and every transcript needs review. Notes can withhold previews and linked post text; a saved URL does not mean the remote page's contents were captured. Apple library formats and Automation behavior can change with macOS updates. Unknown Voice Memos catalogue schemas fail explicitly. See [Notes capture limits](docs/apple-notes-export-format.md).

## Requirements

- An Apple Silicon Mac running macOS 26 or later, logged into the macOS account that owns the Notes and Voice Memos libraries.
- Native arm64 Node.js **24**, npm, CMake, and an Xcode command-line toolchain providing Swift 6.2 or later, available in your shell's `PATH`.
- An existing local Obsidian vault and sufficient storage for the approximately 3.1 GB model, build files, and retained audio. Transcription speed and memory pressure depend on the Mac and recording.
- Internet access during dependency/model setup only. Normal transcription denies network access to the local converter and engine processes.

The native deployment target is macOS 26. Intel Macs and Node running under Rosetta are unsupported. Each installation needs its own library access check. Existing iCloud delivery to the Mac and any vault sync remain separate from this application's local processing.

## Install

Clone the source and run setup:

```sh
git clone https://github.com/ibrahiem9/apple-to-obsidian.git
cd apple-to-obsidian
scripts/setup --vault "$HOME/Documents/Obsidian Vault"
```

Replace the vault argument with your actual vault. Setup checks prerequisites, installs locked Node dependencies, builds **Apple to Obsidian.app**, and downloads/verifies pinned Whisper source and model files. It stages schedules without enabling them. It never installs Homebrew or changes system privacy settings for you.

The app is installed in `~/Applications`. Configuration, import history, private diagnostics, and logs live in `~/Library/Application Support/apple-to-obsidian`. The model lives there at `whisper/models/ggml-large-v3.bin`; Whisper downloads and build files are retained under `whisper`. Your machine's actual paths stay in this local configuration, not in Git. `config.example.json` lists portable defaults. Setup also accepts `--support-path PATH` and `--app-path PATH`; pass `--config PATH/config.json` to subsequent commands when using a custom support directory.

Setup contacts npm, GitHub, and Hugging Face to install dependencies and verified Whisper assets. Importing and transcription happen locally. Your vault's sync provider may upload exported notes and retained audio according to its own settings. Review those settings before importing private material.

1. In **System Settings → Privacy & Security → Full Disk Access**, add the installed **Apple to Obsidian.app**.
2. Check access from the actual launchd executable:

   ```sh
   scripts/install-launchd --check-access all
   ```

3. Allow access to Notes when the Automation prompt appears. If a prompt remains pending or a check times out, finish the permission step and rerun the check. The native app must pass these checks; permission granted to Terminal alone is insufficient.
4. Import and listen to a short single-language sample:

   ```sh
   scripts/install-launchd --pilot --limit 1
   ```

   This imports one pending memo into the vault. Listen to its audio and check the words/script. If it is acceptable, explicitly record your review:

   ```sh
   scripts/install-launchd --review-voice-pilot
   scripts/install-launchd --enable all --accept-single-language-limitations
   ```

You can enable Notes alone with `--enable notes`; Voice Memos acceptance is not needed for that job. A new app build, configuration change, or model change invalidates prior access/review receipts. A short reviewed sample confirms usability for you, not universal transcription accuracy. A full research pilot is optional.

## Daily use

```sh
scripts/run apple-notes-status
scripts/run voice-memos-status
scripts/run apple-notes-sync --dry-run
scripts/run voice-memos-sync --dry-run
scripts/run apple-notes-sync
scripts/run voice-memos-sync --limit 3
scripts/install-launchd --status
scripts/install-launchd --disable all
```

The wrapper runs the installed app with its macOS permissions. Scheduled execution uses the app's bundled CLI and dependencies; it does not depend on the checkout staying in its original location. Node itself must remain installed at the configured path. Rerun setup if that path changes.

A retry for one retained recording can specify its known language:

```sh
scripts/run voice-memos-sync --retry RECORDING_ID --language ur
```

Use `en`, `ar`, `ur`, or `auto`. An explicit retry publishes a separate result rather than overwriting a published note. The default detects the first non-silent block's language and retains it for the whole recording; incorrect detection needs an explicit retry. All speech transcripts carry a review flag. Review flags cannot guarantee accuracy or detect every mixed recording.

## What gets saved

- **Apple Notes:** Markdown converted from Notes HTML, original plaintext, links and deep links exposed by Notes, note/attachment metadata, and exported attachments under `Notes/Apple Notes`. Source HTML and JSON are retained in `Sources`; files are retained in `Attachments`. URL cards keep their titles and source URLs even when Notes cannot save the preview. Later runs update these source-managed notes; older or edited copies are preserved with a link before replacement. Incomplete exports retain the existing copy and report failure. Duplicate exports and notes missing from Apple Notes remain with flags. See [content preservation and limitations](docs/apple-notes-export-format.md).
- **Voice Memos:** original audio under `Notes/Voice Memos/Attachments`, plus a dated Markdown note with embedded audio, metadata, and raw transcript. Stable IDs and hashes prevent repeat imports. Later source edits/deletions do not rewrite retained copies. Moved or renamed Obsidian notes are recognized; deleted notes are not recreated while import history is retained.
- **Local state:** independent durable import/schedule databases and logs. Process failures log aggregate information; sensitive Notes diagnostic payloads remain in private local storage. Imported notes carry local-only metadata, but other software and vault-sync services must independently respect your privacy choices.

See [operation, recovery, upgrades, and removal](docs/operations.md) and [development and verification](docs/development.md). Disabling either job preserves all imported content and history. [Third-party notices](THIRD_PARTY_NOTICES.md) describe dependency and model licenses. The npm package remains private because npm publication is outside this project's distribution method.
