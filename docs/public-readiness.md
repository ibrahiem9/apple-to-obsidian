# Public sharing readiness

Preparation keeps this repository private. Distribution is source-only under MIT;
there are no prebuilt downloads, Developer ID enrollment, or notarized releases.
Changing visibility is a separate owner action.

## Audit scope and policy

The initial review covered all three commits through `6ba3a889900495dd4d437a0a92c46307a263a330`,
all fetched branches/tags/pull-request refs, commit messages and attribution,
and current source, tests, documentation, and dependency locks. The only remote
branch was `main`; there were no tags or pull requests. A local unreachable blob
was also reviewed: it was an older README, with no private content.

The intentional public identity is `ibrahiem9` with GitHub noreply attribution.
New commits must use a GitHub noreply email. Contributor names remain public
commit metadata and should be reviewed before sharing.

`npm run audit:public` checks full fetched history and tracked/nonignored working
files, including staged bytes. It rejects personal/generated filenames, binary
and oversized files, absolute home paths, and non-noreply commit/tag emails. It uses
[Gitleaks 8.30.1](https://github.com/gitleaks/gitleaks/releases/tag/v8.30.1), with
the macOS arm64 archive pinned to SHA-256
`b40ab0ae55c505963e365f271a8d3846efbc170aa17f2607f13df610a9aeb6a5`.
The archive is verified on every run. Scanner output is redacted and temporary
scan copies/reports are removed. The tool cache stays under ignored `.build`.

There is one exact path exception: the invented `private/vault` home-path
sentinel in `test/apple-notes.test.ts`, used to prove error redaction. It applies
only to that literal in that file. Other fixtures generate invented notes,
catalogues, and audio in temporary directories. There are no project-specific
secret-scanner allowlists or whole-test-directory exemptions. Third-party license attributions
are intentional upstream public identities.

Fetch all refs before a publication review; a local scan cannot find unfetched
GitHub refs or inspect arbitrary prose for personal meaning. GitHub issues,
comments, releases, logs, and artifacts require a separate review. The initial
GitHub review found one synthetic-feature roadmap issue, no issue/commit/review
comments, no releases, no Actions runs or artifacts, and no wiki or discussions.
The final review included the preparation runs' complete logs and fresh
paginated repository metadata. Gitleaks and a separate personal-path review
found no unresolved publication findings. Generic hosted-runner paths are
expected. Authenticated API-only temporary clone credentials were excluded from
the content snapshot; they were never copied to this repository or CI logs.
There are no uploaded workflow artifacts. The locked dependency/license review
also has no unresolved findings; see [third-party notices](../THIRD_PARTY_NOTICES.md).

## Verification results

Tested implementation commit: [`086e299dca8bad0a88e8997fc5cec618b0ef62da`](https://github.com/ibrahiem9/apple-to-obsidian/commit/086e299dca8bad0a88e8997fc5cec618b0ef62da).
Results recorded on 2026-09-28. This readiness-record update changes documentation only.

| Check | Result |
| --- | --- |
| Local public audit | Passed, complete history/index/working files and pinned Gitleaks |
| Local `npm run verify` | Passed: 74 TypeScript tests, 12 native tests, installer regression checks, network-denial check |
| Local `npm run verify:app` | Passed: temporary signed app, bundled commands and dependencies/notices, 12 native tests through the installed helper |
| [Hosted Verification](https://github.com/ibrahiem9/apple-to-obsidian/actions/runs/36448652555) | Passed: public audit, full regression suite, actual packaged app |
| [Hosted Clean installation](https://github.com/ibrahiem9/apple-to-obsidian/actions/runs/36448678464) | Passed: real setup twice, source/model checksum checks, Whisper executable, retained config/SQLite/content, Unicode paths, packaged app |
| GitHub content and log review | Passed: no unresolved personal-content or credential findings; no artifacts or releases |

Hosted toolchain: `macos-26` arm64, image `20260907.0351.1`, macOS **26.6.2**,
Node **24.20.0**, Apple Swift **6.3.3**, CMake **4.4.3**. Both workflows record
the commit and toolchain in their logs and job summary. Local checks used macOS
**27.0** arm64, Node **24.7.0**, and Apple Swift **6.4**.

The first hosted runs exposed an entry-point filename conflict under Swift 6.3.
Renaming `main.swift` to `VoiceMemos.swift` fixed it without changing runtime
behavior. Both successful runs above include that fix. No personal libraries,
vaults, credentials, or scheduled jobs were supplied to these checks.

The [Verification workflow](../.github/workflows/verify.yml) uses `macos-26`
(Apple Silicon), as documented in the
[GitHub runner reference](https://docs.github.com/en/actions/reference/runners/github-hosted-runners).
It runs the privacy audit, regression suite, and actual app build/checks.
The [Clean installation workflow](../.github/workflows/installation.yml) runs
real setup twice in temporary directories with checksum-pinned Whisper source
and model downloads. It leaves schedules disabled and uses only synthetic data.

CI does not certify interactive Full Disk Access or Notes Automation, iCloud
delivery, transcription accuracy, or compatibility with future Apple library
formats. Users still need the documented on-device permission check and voice
pilot. Personal vaults and active nightly jobs are outside these checks.
