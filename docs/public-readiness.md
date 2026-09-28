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
files. It rejects personal/generated filenames, binary and oversized files,
absolute home paths, and non-noreply commit emails. It uses
[Gitleaks 8.30.1](https://github.com/gitleaks/gitleaks/releases/tag/v8.30.1), with
the macOS arm64 archive pinned to SHA-256
`b40ab0ae55c505963e365f271a8d3846efbc170aa17f2607f13df610a9aeb6a5`.
The archive is verified on every run. Scanner output is redacted and temporary
scan copies/reports are removed. The tool cache stays under ignored `.build`.

There is one exact path exception: the invented `private/vault` home-path
sentinel in `test/apple-notes.test.ts`, used to prove error redaction. It applies
only to that literal in that file. Other fixtures generate invented notes,
catalogues, and audio in temporary directories. There are no secret-scanner
allowlists or whole-test-directory exemptions. Third-party license attributions
are intentional upstream public identities.

Fetch all refs before a publication review; a local scan cannot find unfetched
GitHub refs or inspect arbitrary prose for personal meaning. GitHub issues,
comments, releases, logs, and artifacts require a separate review. The initial
GitHub review found one synthetic-feature roadmap issue, no issue/commit/review
comments, no releases, no Actions runs or artifacts, and no wiki or discussions.
New CI logs will be reviewed before this preparation is marked complete.

## Verification results

Hosted verification is pending. This record will be updated with the tested
commit, run links, toolchain versions, and results after the private CI runs.

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
