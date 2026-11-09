#!/bin/sh
# 启动本地开发服务并打开浏览器
cd "$(dirname "$0")" || exit 1
PORT=${1:-5180}
echo "单词学习台已启动： http://127.0.0.1:${PORT}"
(sleep 2 && open "http://127.0.0.1:${PORT}") &
npx vite --port "${PORT}" --host 127.0.0.1
