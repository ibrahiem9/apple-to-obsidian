# Mixed-language transcription research

Future feature; unsupported in the installed app. The production backend accepts
only one language per memo: English, Arabic, or Urdu.

This archive retains the generic language-boundary planner, experimental Whisper
adapter, and synthetic regression tests. It contains no recordings, user reviews,
transcripts, reference text, or machine configuration. Synthetic boundary tests
verify mechanics, not real mixed-language transcription accuracy.

From the repository root, after installing development dependencies:

```sh
npx tsc -p experiments/mixed-language/tsconfig.json
node --test .build/mixed-language/test/*.test.js
```

The planner uses overlapping language probes, wider confirmation for brief hints,
acoustic pauses, and passage confirmation. Short switches, language confusion,
unintended translation, and script errors still require better evaluation. Do not
expose this backend through production flags until independently reviewed English,
Arabic, Urdu, and mixed recordings pass without human-supplied switch times.

The separate `omnilingual` directory is a pinned Core ML comparison tool. It is not
installed or called by production. Building it and downloading its model are
explicit research steps; its dependency closure is larger than the shipped app.
Keep research inputs and outputs outside the repository and run inference with
network access denied. The selected production engine remains Whisper Large v3.
