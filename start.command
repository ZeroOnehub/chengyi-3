#!/bin/bash
# 双击启动承艺本地预览（需要 macOS 自带或已安装的 python3）
cd "$(dirname "$0")"
PORT=5180
echo "承艺 3.0 本地预览：http://localhost:$PORT"
echo "关闭这个窗口即可停止预览。"
(sleep 1 && open "http://localhost:$PORT") &
python3 -m http.server $PORT --bind 127.0.0.1
