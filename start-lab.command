#!/bin/zsh
# 本机开发/试用启动脚本。正式部署到服务器请看 deploy/README.md。
cd "$(dirname "$0")"

PORT=5299

if lsof -i :$PORT > /dev/null 2>&1; then
  echo "错误：端口 $PORT 已被占用，请先关闭占用该端口的程序。"
  lsof -i :$PORT
  exit 1
fi

if [ ! -d .venv ]; then
  echo "首次运行，正在创建虚拟环境并安装依赖…"
  python3 -m venv .venv || exit 1
  ./.venv/bin/pip install --quiet --upgrade pip
  ./.venv/bin/pip install --quiet fastapi "uvicorn[standard]" pydantic python-multipart argon2-cffi || {
    echo "依赖安装失败，请检查网络。"; exit 1; }
  echo "依赖装好了。"
fi

export LAB_BENCH_DB="${LAB_BENCH_DB:-$PWD/server/lab.db}"
export LAB_BENCH_UPLOADS="${LAB_BENCH_UPLOADS:-$PWD/server/uploads}"
# 本机用 http，所以关掉 Secure Cookie。放到服务器上必须是 1。
export LAB_BENCH_SECURE_COOKIE=0

if ! ./.venv/bin/python server/manage.py listusers 2>/dev/null | grep -q .; then
  echo
  echo "还没有任何账号，先建一个导师账号："
  ./.venv/bin/python server/manage.py createadmin || exit 1
  echo
fi

echo "课题组管理台正在运行："
echo "http://localhost:$PORT"
echo "（按 Ctrl+C 停止）"
cd server && exec ../.venv/bin/python -m uvicorn app:app --host 127.0.0.1 --port $PORT
