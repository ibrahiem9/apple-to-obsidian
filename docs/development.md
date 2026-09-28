# Development and verification

This personal project is distributed as MIT-licensed source. Production consists of a TypeScript CLI/importers, a Swift catalogue/permission bridge, a JXA Notes reader, and local build/install scripts. There is no model-service client or idea-management coordinator. Build locally; no prebuilt download, Developer Program enrollment, or notarization is required.

```sh
npm ci --ignore-scripts
npm run audit:public
npm run verify
npm run verify:app
```

`npm run verify` builds TypeScript, runs synthetic importer and configuration tests, builds the macOS native helper, tests read-only catalogue handling, verifies installer behavior in temporary directories, and proves the production transcription sandbox denies a reachable network endpoint. Coverage includes Unicode paths, incomplete exports, retries, and retained content. Use macOS 26+ arm64 and native arm64 Node 24. The native build needs Swift 6.2+. Experimental mixed-language tests have a separate command in their directory and are excluded from the production app.

`npm run verify:app` builds the app in a temporary directory and exercises its bundled commands outside the checkout. It checks that the app carries the code and resources it needs. Node remains an external prerequisite at the configured path.

Tests use invented content and generated audio. They do not require access to personal Notes or Voice Memos. Real Full Disk Access and Notes Automation checks occur during each user's installation; synthetic tests cannot establish those permissions. A clean checkout can build and stage the app without any path or state from the original development project.

The model setup pins whisper.cpp source by commit/archive SHA-256 and Large v3 weights by revision/SHA-256. It builds Metal acceleration and embeds Metal resources. Research-only Core ML code has its own pinned dependency closure; it is never installed with production. [Third-party notices](../THIRD_PARTY_NOTICES.md) cover dependencies and model provenance. Locally built apps include the relevant notices in their resources. Keep these notices with redistributed dependencies or model assets.

## GitHub verification

The [Verification workflow](../.github/workflows/verify.yml) runs on pushes, pull requests, and manual dispatch. It uses GitHub's macOS 26 Apple Silicon runner, Node 24, and Swift 6.2 or newer. It runs the public audit, existing verification suite, and packaged-app checks. Workflow permissions are read-only, and third-party actions are pinned to commits.

The [Clean installation workflow](../.github/workflows/installation.yml) is manually dispatched because it downloads and builds pinned Whisper assets, including the approximately 3.1 GB Large v3 model. Its `npm run verify:install` command runs real setup with temporary vault, support, and app directories. It verifies checksums and repeats setup to check that configuration and state survive. Run it locally only when you intend to make those downloads:

```sh
npm run verify:install
```

These checks leave schedules disabled and use synthetic content. Never provide personal Apple libraries or credentials to CI. Hosted CI does not certify interactive Notes permissions, iCloud delivery, or transcription accuracy. See the [public-sharing readiness record](public-readiness.md) for the tested commit, runner/toolchain versions, and actual results.

## Public audit

`npm run audit:public` runs a pinned secret scanner and checks for accidentally tracked personal or generated files. Synthetic fixtures may need narrowly documented exceptions. An automated scan cannot establish that every arbitrary sentence is safe to publish, so inspect new fixtures and documentation too.

Before pushing, inspect staged source and Git history for secrets and personal data. Include branches, tags, and commit metadata in a publication review. Check GitHub issues, comments, releases, Actions logs, and artifacts separately; a local source scan does not cover them. The public author identity is `ibrahiem9`, with GitHub noreply attribution.

Keep tests synthetic. Never commit the installed app, local config, generated launchd plists, model weights, state databases, recordings, transcripts, reports based on private recordings, or diagnostic payloads. Generic standard macOS paths and environment-variable names are part of the installer, not user-specific configuration. Keep findings sanitized: report the category and location without copying private values into logs, commits, or issues.
