#!/bin/zsh
# 双击运行回归测试。
cd "$(dirname "$0")"

PY=python3
[ -x .venv/bin/python ] && PY=.venv/bin/python

if ! $PY -c "import pytest, httpx" 2>/dev/null; then
  echo "缺少测试依赖，正在安装…"
  $PY -m pip install --quiet pytest httpx || { echo "安装失败，请检查网络。"; exit 1; }
fi

cd server && exec $PY -m pytest tests -q
