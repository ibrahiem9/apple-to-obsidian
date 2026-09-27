# Development and verification

Production consists of a TypeScript CLI/importers, a Swift catalogue/permission bridge, a JXA Notes reader, and local build/install scripts. There is no model-service client or idea-management coordinator.

```sh
npm ci --ignore-scripts
npm run verify
```

Verification builds TypeScript, runs synthetic importer and configuration tests, builds the macOS native helper, tests read-only catalogue handling, verifies installer behavior in temporary directories, and proves the production transcription sandbox denies a reachable network endpoint. Use macOS 26+ arm64 and Node 24. The native build needs Swift 6.2+. Experimental mixed-language tests have a separate command in their directory and are excluded from the production app.

Tests use invented content and generated audio. They do not require access to personal Notes or Voice Memos. Real Full Disk Access and Notes Automation checks occur during each user's installation; synthetic tests cannot establish those permissions. A clean checkout can build and stage the app without any path or state from the original development project.

The model setup pins whisper.cpp source by commit/archive SHA-256 and Large v3 weights by revision/SHA-256. It builds Metal acceleration and embeds Metal resources. Research-only Core ML code has its own pinned dependency closure; it is never installed with production. Retain upstream license notices when distributing dependencies or model assets.

Before pushing, inspect staged source and Git history for secrets and personal data. Keep tests synthetic. Never commit the installed app, local config, generated launchd plists, model weights, state databases, recordings, transcripts, reports based on private recordings, or diagnostic payloads. Generic standard macOS paths and environment-variable names are part of the installer, not user-specific configuration.
