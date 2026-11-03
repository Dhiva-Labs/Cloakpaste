#!/usr/bin/env bash
# Downloads the int8 PII model weights (28.7 MB) and checks their hash.
# Model: gravitee-io/bert-small-pii-detection (Apache-2.0).
set -euo pipefail
cd "$(dirname "$0")/.."
REV=main
URL="https://huggingface.co/gravitee-io/bert-small-pii-detection/resolve/$REV/model.quant.onnx"
SHA=b227845ff4989c9f7383874b841895dfbdb9a4d7a20ceb39c3f187271894bf2a
OUT=models/pii/onnx/model_quantized.onnx
mkdir -p "$(dirname "$OUT")"
if [ -f "$OUT" ] && echo "$SHA  $OUT" | sha256sum -c --quiet 2>/dev/null; then
  echo "Model already present."; exit 0
fi
curl -fL --retry 3 -o "$OUT.part" "$URL"
echo "$SHA  $OUT.part" | sha256sum -c --quiet
mv "$OUT.part" "$OUT"
echo "Model saved to $OUT"
