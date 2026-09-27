# Future features

## Mixed-language transcription — deferred

Support English, Arabic, and Urdu within the same recording, including short switches and recordings spanning multiple processing blocks. This feature is not supported by production and is not a requirement for single-language installation.

The reusable prototype and synthetic tests are retained under `experiments/mixed-language`. Do not enable it by changing production configuration.

Acceptance for future implementation:

- Independent, representative mixed recordings are transcribed without human-supplied switch timestamps or forced language order.
- Preserve speech and original scripts across switches; evaluate omissions, wrong-language scripts, unintended translation, short passages, silence/noise, and long recordings.
- Improve mixed recognition without regressing English-only, Arabic-only, or Urdu-only results.
- Measure accuracy against local human references and record only aggregate results in development logs; retain all personal audio/text locally.
- Keep offline processing, bounded memory, preserved audio, and explicit review flags.

The GitHub tracking issue is linked here after repository creation.
