# Third-party notices

Apple to Obsidian source is licensed under the [MIT License](LICENSE), copyright
2026 ibrahiem9. Third-party code and models retain their own licenses and
copyrights. This project is not affiliated with Apple, Obsidian, OpenAI, or Meta.

## Locked JavaScript dependencies

This inventory covers every dependency in `package-lock.json`, including build
and type dependencies. Copies below come from the installed locked packages.
Locally built app resources include this document, `LICENSE`, and `licenses/`.
The app bundles the four runtime packages; development entries are used to build
and test the source. TypeScript's additional [third-party notices](licenses/npm/typescript/ThirdPartyNoticeText.txt)
are retained alongside its Apache license.

| Package | Locked version | License | Use | License copy |
| --- | --- | --- | --- | --- |
| [@mixmark-io/domino](https://www.npmjs.com/package/@mixmark-io/domino/v/2.2.0) | 2.2.0 | BSD-2-Clause | Runtime | [Text](licenses/npm/@mixmark-io__domino/LICENSE) |
| [@types/node](https://www.npmjs.com/package/@types/node/v/24.13.3) | 24.13.3 | MIT | Development | [Text](licenses/npm/@types__node/LICENSE) |
| [@types/turndown](https://www.npmjs.com/package/@types/turndown/v/5.0.6) | 5.0.6 | MIT | Development | [Text](licenses/npm/@types__turndown/LICENSE) |
| [turndown](https://www.npmjs.com/package/turndown/v/7.2.4) | 7.2.4 | MIT | Runtime | [Text](licenses/npm/turndown/LICENSE) |
| [turndown-plugin-gfm](https://www.npmjs.com/package/turndown-plugin-gfm/v/1.0.2) | 1.0.2 | MIT | Runtime | [Text](licenses/npm/turndown-plugin-gfm/LICENSE) |
| [typescript](https://www.npmjs.com/package/typescript/v/5.9.3) | 5.9.3 | Apache-2.0 | Development | [Text](licenses/npm/typescript/LICENSE.txt) |
| [undici-types](https://www.npmjs.com/package/undici-types/v/7.18.2) | 7.18.2 | MIT | Development | [Text](licenses/npm/undici-types/LICENSE) |
| [yaml](https://www.npmjs.com/package/yaml/v/2.9.0) | 2.9.0 | ISC | Runtime | [Text](licenses/npm/yaml/LICENSE) |

## Production transcription runtime and model

`scripts/setup-voice-whisper` downloads and builds
[whisper.cpp v1.8.3](https://github.com/ggml-org/whisper.cpp/tree/2eeeba56e9edd762b4b38467bab96c2517163158),
revision `2eeeba56e9edd762b4b38467bab96c2517163158`, under
[MIT](licenses/whisper/whisper.cpp-LICENSE). That source includes ggml. The source
archive SHA-256 is `089b898aa83b24a8321e0fd554eeb0967fb03dd687e27f6374c72d3363b5b429`.
The setup builds the CPU/Metal command-line runtime locally; no prebuilt runtime
or model is distributed in this repository or app bundle.

The pinned runtime includes these additional notices:

- [miniaudio](licenses/whisper/miniaudio.h-LICENSE), copyright 2025 David Reid:
  `MIT-0 OR Unlicense`; the complete alternatives are copied from `examples/miniaudio.h`.
- [stb_vorbis](licenses/whisper/stb_vorbis.c-LICENSE), copyright 2017 Sean Barrett:
  `MIT OR Unlicense`; the complete alternatives are copied from `examples/stb_vorbis.c`.
- [ggml embedded notices](licenses/whisper/ggml-embedded-NOTICES): MIT notices for
  Mozilla's llamafile matrix code, YaRN code by Jeffrey Quesnelle and Bowen Peng,
  and optional Arm KleidiAI integration headers. The standard setup leaves
  KleidiAI and non-Apple GPU backends disabled.

The unquantized `ggml-large-v3.bin` model is OpenAI Whisper large-v3 converted to
ggml format by ggerganov. It is downloaded from
[the pinned model repository](https://huggingface.co/ggerganov/whisper.cpp/blob/5359861c739e955e79d9a303bcbc70fb988958b1/README.md),
revision `5359861c739e955e79d9a303bcbc70fb988958b1`, whose model card declares MIT.
Its SHA-256 is `64d182b440b98d5203c4f9bd541544d84c605196c4f7b845dfa11fb23594d1e2`.
The [OpenAI Whisper MIT license](licenses/whisper/openai-whisper-LICENSE) is
included (copied from upstream tag `v20250625`); [OpenAI's upstream repository](https://github.com/openai/whisper#license)
applies MIT to both code and model weights. Source archive and model checksums
are verified before setup installs them. Setup retains the downloaded source
and its original notices in the support directory.

## macOS libraries and development tools

The production Swift package has no third-party Swift package dependencies.
It links Apple's system frameworks and system SQLite. These remain part of
macOS, governed by Apple's platform terms and notices; they are not copied into
the app. Node, Swift, Xcode command-line tools, CMake, and Git are separately
installed build/runtime prerequisites and are not redistributed here. SQLite
upstream is [public domain](https://www.sqlite.org/copyright.html).

## Experimental mixed-language pilot

`experiments/mixed-language/omnilingual` is an optional research pilot, excluded
from the supported installation and app runtime. Its Swift dependency graph is
locked separately in `Package.resolved`. The table below records every locked
package's root license, with original root LICENSE/NOTICE files preserved under
`licenses/experimental/`. Exact revisions, upstream URLs, and copied filenames
are recorded in [the inventory](licenses/experimental/inventory.json).
These are package-level licenses; individual vendored components retain the
additional notices included in their upstream source trees. No experimental
binaries, package source trees, or model weights are redistributed here.

| Package | Version or revision | Root license | Copies |
| --- | --- | --- | --- |
| [async-http-client](https://github.com/swift-server/async-http-client/tree/f95c908967e98c68c5ce3fd61a7974e7e869e303) | 1.36.1 | Apache-2.0 | [Texts](licenses/experimental/async-http-client/) |
| [compress-nio](https://github.com/adam-fowler/compress-nio/tree/e1caa19077dda4b00441142ef57da3db02acd466) | 1.4.2 | Apache-2.0 | [Texts](licenses/experimental/compress-nio/) |
| [eventsource](https://github.com/mattt/eventsource/tree/86b5096ac59ab46e66bd1f6377c604bc1dab0bc2) | 1.5.1 | MIT | [Texts](licenses/experimental/eventsource/) |
| [hummingbird](https://github.com/hummingbird-project/hummingbird/tree/3ae359b1bb1e72378ed43b59fdcd4d44cac5d7a4) | 2.16.0 | Apache-2.0 | [Texts](licenses/experimental/hummingbird/) |
| [hummingbird-websocket](https://github.com/hummingbird-project/hummingbird-websocket/tree/716c54294152c6d3301a6239a1d74db57cbcd6dc) | 2.6.0 | Apache-2.0 | [Texts](licenses/experimental/hummingbird-websocket/) |
| [mlx-swift](https://github.com/ml-explore/mlx-swift/tree/0bb916c67f4b9e5c682cbe02a42c701c93ab5021) | 0.31.6 | MIT | [Texts](licenses/experimental/mlx-swift/) |
| [mlx-swift-lm](https://github.com/ml-explore/mlx-swift-lm/tree/bd4b7434e6bdb588c7ef55706ff8904cb7fd4c57) | 3.31.4 | MIT | [Texts](licenses/experimental/mlx-swift-lm/) |
| [speech-swift](https://github.com/soniqo/speech-swift/tree/cb4ed4cded5c1207bb0727e91073d7c83df90a21) | cb4ed4cded5c | Apache-2.0 | [Texts](licenses/experimental/speech-swift/) |
| [swift-algorithms](https://github.com/apple/swift-algorithms/tree/87e50f483c54e6efd60e885f7f5aa946cee68023) | 1.2.1 | Apache-2.0 WITH Swift-exception | [Texts](licenses/experimental/swift-algorithms/) |
| [swift-argument-parser](https://github.com/apple/swift-argument-parser/tree/6a52f3251125d74daf04fcbd5e6f08a75d074382) | 1.8.2 | Apache-2.0 WITH Swift-exception | [Texts](licenses/experimental/swift-argument-parser/) |
| [swift-asn1](https://github.com/apple/swift-asn1/tree/3b6410f7dee09eb33cdd26260c5fd47fda19b0e2) | 1.7.3 | Apache-2.0 | [Texts](licenses/experimental/swift-asn1/) |
| [swift-async-algorithms](https://github.com/apple/swift-async-algorithms/tree/789dcf1f3d3f00251482f40a432ab7144c181987) | 1.1.6 | Apache-2.0 WITH Swift-exception | [Texts](licenses/experimental/swift-async-algorithms/) |
| [swift-atomics](https://github.com/apple/swift-atomics/tree/0442cb5a3f98ab802acb777929fdb446bda11a34) | 1.3.1 | Apache-2.0 WITH Swift-exception | [Texts](licenses/experimental/swift-atomics/) |
| [swift-certificates](https://github.com/apple/swift-certificates/tree/ff86b924ead66f853b8baf91f3c41926a8f36177) | 1.21.0 | Apache-2.0 | [Texts](licenses/experimental/swift-certificates/) |
| [swift-collections](https://github.com/apple/swift-collections/tree/a66de878e87ef5a3d5d390e0f6d9002aa5541a43) | 1.7.0 | Apache-2.0 WITH Swift-exception | [Texts](licenses/experimental/swift-collections/) |
| [swift-configuration](https://github.com/apple/swift-configuration/tree/3533f65d3e36dcdffc91ce34ef4d3c9c1887fd4b) | 1.2.1 | Apache-2.0 | [Texts](licenses/experimental/swift-configuration/) |
| [swift-crypto](https://github.com/apple/swift-crypto/tree/da9d28d69ebe3894b18376c8f2395c2f37b8448f) | 4.5.2 | Apache-2.0 | [Texts](licenses/experimental/swift-crypto/) |
| [swift-distributed-tracing](https://github.com/apple/swift-distributed-tracing/tree/cc504a45f6ce73ce6067837d7ac19fa67b229a56) | 1.5.0 | Apache-2.0 | [Texts](licenses/experimental/swift-distributed-tracing/) |
| [swift-http-structured-headers](https://github.com/apple/swift-http-structured-headers/tree/933538faa42c432d385f02e07df0ace7c5ecfc47) | 1.7.0 | Apache-2.0 | [Texts](licenses/experimental/swift-http-structured-headers/) |
| [swift-http-types](https://github.com/apple/swift-http-types/tree/bff4b6903cdc99dda49649dd52f46c11cfd3ed50) | 1.8.0 | Apache-2.0 | [Texts](licenses/experimental/swift-http-types/) |
| [swift-huggingface](https://github.com/huggingface/swift-huggingface/tree/f2f99991f2d7d8fdb3187e4fd539cd2facf5c13d) | 0.11.0 | Apache-2.0 | [Texts](licenses/experimental/swift-huggingface/) |
| [swift-jinja](https://github.com/huggingface/swift-jinja/tree/4588064a20f3fc093c95f2f7d3359999bf30cae5) | 2.5.1 | Apache-2.0 | [Texts](licenses/experimental/swift-jinja/) |
| [swift-log](https://github.com/apple/swift-log/tree/9c6fb14227f55d8f711ce3847dc2f419fb0ecacb) | 1.15.1 | Apache-2.0 | [Texts](licenses/experimental/swift-log/) |
| [swift-metrics](https://github.com/apple/swift-metrics/tree/087e8074afa97040c3b870c8664fe5482fb87cc4) | 2.11.0 | Apache-2.0 | [Texts](licenses/experimental/swift-metrics/) |
| [swift-nio](https://github.com/apple/swift-nio/tree/21de5f08c1a166a6dd293d0e587ad977bf8dac5d) | 2.103.0 | Apache-2.0 | [Texts](licenses/experimental/swift-nio/) |
| [swift-nio-extras](https://github.com/apple/swift-nio-extras/tree/41449336c8ecfadac6b4b5be75f9c3c306e61ced) | 1.35.1 | Apache-2.0 | [Texts](licenses/experimental/swift-nio-extras/) |
| [swift-nio-http2](https://github.com/apple/swift-nio-http2/tree/0f3e54e29c944c2e835ad52159da7d9e1c94ac69) | 1.46.0 | Apache-2.0 | [Texts](licenses/experimental/swift-nio-http2/) |
| [swift-nio-ssl](https://github.com/apple/swift-nio-ssl/tree/322f3c2a4a21df31c84ca416bf65ee5e9059e440) | 2.37.5 | Apache-2.0 | [Texts](licenses/experimental/swift-nio-ssl/) |
| [swift-nio-transport-services](https://github.com/apple/swift-nio-transport-services/tree/67787bb645a5e67d2edcdfbe48a216cc549222d5) | 1.28.0 | Apache-2.0 | [Texts](licenses/experimental/swift-nio-transport-services/) |
| [swift-numerics](https://github.com/apple/swift-numerics/tree/0c0290ff6b24942dadb83a929ffaaa1481df04a2) | 1.1.1 | Apache-2.0 WITH Swift-exception | [Texts](licenses/experimental/swift-numerics/) |
| [swift-sdk](https://github.com/modelcontextprotocol/swift-sdk/tree/a0ae212ebf6eab5f754c3129608bc5557637e605) | 0.12.1 | Apache-2.0 AND MIT; documentation CC-BY-4.0 | [Texts](licenses/experimental/swift-sdk/) |
| [swift-service-context](https://github.com/apple/swift-service-context/tree/d0997351b0c7779017f88e7a93bc30a1878d7f29) | 1.3.0 | Apache-2.0 | [Texts](licenses/experimental/swift-service-context/) |
| [swift-service-lifecycle](https://github.com/swift-server/swift-service-lifecycle/tree/7f9326b0326ff86e3646295ea6e891f68c471c5e) | 2.12.0 | Apache-2.0 | [Texts](licenses/experimental/swift-service-lifecycle/) |
| [swift-syntax](https://github.com/swiftlang/swift-syntax/tree/79e4b74a295b6eb74a8b585e3a39d29e70c1dbd1) | 603.0.2 | Apache-2.0 WITH Swift-exception | [Texts](licenses/experimental/swift-syntax/) |
| [swift-system](https://github.com/apple/swift-system/tree/869129b7bf4ecc57b97d0193ad29690ca2134750) | 1.8.1 | Apache-2.0 WITH Swift-exception | [Texts](licenses/experimental/swift-system/) |
| [swift-transformers](https://github.com/huggingface/swift-transformers/tree/c21fdcde390313a6d98d8e33a346f2c3486c3ab0) | 1.3.4 | Apache-2.0 | [Texts](licenses/experimental/swift-transformers/) |
| [swift-websocket](https://github.com/hummingbird-project/swift-websocket/tree/ca48d46c25f8fa948d37eaa480c73172182cf90f) | 1.5.0 | Apache-2.0 | [Texts](licenses/experimental/swift-websocket/) |
| [whisperkit](https://github.com/argmaxinc/WhisperKit/tree/1e2a163736dfa5a198e637ae44c114e1c6d5cc2d) | 1.1.0 | MIT | [Texts](licenses/experimental/whisperkit/) |
| [yyjson](https://github.com/ibireme/yyjson/tree/8b4a38dc994a110abaec8a400615567bd996105f) | 0.12.0 | MIT | [Texts](licenses/experimental/yyjson/) |

The Swift runtime-library exception is retained verbatim where present. The
MCP Swift SDK's pinned license describes a transition: code includes Apache-2.0
and remaining MIT contributions, while documentation uses CC-BY-4.0. It must not
be described as uniformly MIT or Apache-2.0.

The optional pilot downloads
[aufklarer's Core ML INT8 conversion](https://huggingface.co/aufklarer/Omnilingual-ASR-CTC-300M-CoreML-INT8-10s/blob/ce99f14bbc768d8dc6ffd3235a21cd9751ceb139/README.md)
of [Meta's omniASR-CTC-300M](https://huggingface.co/facebook/omniASR-CTC-300M).
The pinned conversion card declares Apache-2.0 and identifies Meta's base model.
The pilot uses revision `ce99f14bbc768d8dc6ffd3235a21cd9751ceb139`; its setup script
verifies each asset using a pinned Git blob hash or SHA-256. It downloads the
compiled Core ML model, tokenizer, and configuration. The model remains outside
the repository and production app; using the pilot does not make it a supported
transcription path. [Apache-2.0 text](licenses/experimental/speech-swift/LICENSE)
is included among the experimental notices.

## Updating dependencies

When changing a lockfile, runtime revision, or model revision, refresh this
inventory and the copied license/notice texts from that exact version. Preserve
upstream copyright and attribution notices, including embedded components when
changing runtime build options. New redistributions of experimental binaries
must carry the notices for their actual bundled components as well.
