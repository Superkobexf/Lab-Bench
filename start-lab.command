#!/bin/zsh
cd "$(dirname "$0")"
if lsof -i :5299 > /dev/null 2>&1; then
  echo "错误：端口 5299 已被占用，请先关闭占用该端口的程序。"
  echo "占用进程："
  lsof -i :5299
  exit 1
fi
echo "课题组管理台正在运行："
echo "http://localhost:5299"
python3 -m http.server 5299 --bind 127.0.0.1
