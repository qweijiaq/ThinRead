# Kokoro voice model

The app can bundle the Kokoro-82M v1.1 Chinese ONNX model here so local TTS works
without a manual download.

Model: https://hf-mirror.com/onnx-community/Kokoro-82M-v1.1-zh-ONNX
License: Apache-2.0

Run `pnpm fetch:kokoro` from the repository root to download the ignored model,
tokenizer and default voice files. Packaged builds include this directory as
`Resources/kokoro`.
