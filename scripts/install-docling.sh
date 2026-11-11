#!/usr/bin/env bash
set -euo pipefail

DATA_DIR="${1:-$HOME/Library/Application Support/reading-notes}"
if [[ "$(uname -s)" != "Darwin" ]]; then
  DATA_DIR="${1:-${XDG_DATA_HOME:-$HOME/.local/share}/reading-notes}"
fi

PYTHON="${PYTHON:-}"
if [[ -z "$PYTHON" ]]; then
  for candidate in python3.12 python3.13 python3.11 python3.10 python3; do
    if command -v "$candidate" >/dev/null 2>&1; then
      if "$candidate" -c 'import sys; raise SystemExit(0 if sys.version_info >= (3, 10) else 1)' 2>/dev/null; then
        PYTHON="$candidate"
        break
      fi
    fi
  done
fi

if [[ -z "$PYTHON" ]]; then
  echo "需要 Python 3.10 或更高版本。请先安装 Python，再重新运行。"
  exit 1
fi

echo "使用 $($PYTHON --version 2>&1) 安装 Docling 到：$DATA_DIR/docling-venv"
"$PYTHON" -m venv "$DATA_DIR/docling-venv"
"$DATA_DIR/docling-venv/bin/pip" install --upgrade pip
"$DATA_DIR/docling-venv/bin/pip" install docling
echo "完成。重启页边后，在 PDF 导入或重新解析时勾选「Docling 深度解析」。"
echo "如果下载模型超时，可以在运行前设置：export HF_ENDPOINT=https://hf-mirror.com"
