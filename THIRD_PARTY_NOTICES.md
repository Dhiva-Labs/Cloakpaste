# Third-party components

## Bundled in the extension

Licence files are in the package's `licenses/` folder. `licenses/Apache-2.0.txt`
is copied from `@huggingface/transformers` at build time; the others are in
this repository's `licenses/` folder.

| Component | Version | Use | Licence | Licence file |
|---|---|---|---|---|
| [gravitee-io/bert-small-pii-detection](https://huggingface.co/gravitee-io/bert-small-pii-detection) | int8 ONNX weights | PII model weights and tokenizer | Apache-2.0 | `licenses/Apache-2.0.txt` |
| [prajjwal1/bert-small](https://huggingface.co/prajjwal1/bert-small) by Prajjwal Bhargava | | Base model the above was fine-tuned from | MIT (as stated on the model card) | `licenses/bert-small-MIT.txt` |
| [Google Research BERT](https://github.com/google-research/bert) | | Checkpoints prajjwal1/bert-small was converted from | Apache-2.0 | `licenses/Apache-2.0.txt` |
| [transformers.js](https://github.com/huggingface/transformers.js) (`@huggingface/transformers`) | 4.3.2 | Tokenizer and model runner | Apache-2.0 | `licenses/Apache-2.0.txt` |
| [`@huggingface/tokenizers`](https://github.com/huggingface/tokenizers.js), included in transformers.js' web build | 0.2.0 | Tokenizer | Apache-2.0 | `licenses/Apache-2.0.txt` |
| [`@huggingface/jinja`](https://github.com/huggingface/huggingface.js/tree/main/packages/jinja), included in transformers.js' web build | 0.5.10 | Template engine | MIT | `licenses/huggingface-jinja-MIT.txt` |
| [ONNX Runtime Web](https://github.com/microsoft/onnxruntime): `onnxruntime-web` and `onnxruntime-common` | 1.31.0-dev.20260914-8d85527a0 and 1.30.0 | WebAssembly inference | MIT | `licenses/onnxruntime-MIT.txt` |
| Third-party code compiled into ONNX Runtime's WebAssembly | ONNX Runtime commit 8d85527a0 | Part of the runtime above | Various, listed in the file | `licenses/onnxruntime-ThirdPartyNotices.txt` |

## Build and tests only (not shipped)

| Component | Use | Licence |
|---|---|---|
| [esbuild](https://esbuild.github.io) | bundling, not shipped | MIT |
| [Puppeteer](https://pptr.dev) (`puppeteer-core`) | end-to-end tests, not shipped | Apache-2.0 |
| [ProseMirror](https://prosemirror.net) | end-to-end test fixture, not shipped | MIT |
