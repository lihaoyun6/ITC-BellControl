#!/bin/sh
# 起播放代理，顺带把 bell-panel 当网页目录伺服出去，然后打开面板。
#
# 两个口别混：
#   · 127.0.0.1:8181 —— 代理自己的 WebSocket 控制口（面板「全局设置 → 播放代理」
#     默认就连这儿），不是网页；
#   · 127.0.0.1:8182 —— --web-dir 开出来的静态托管口，面板网页在这儿。
#
# 代理现在默认绑 0.0.0.0（给装在服务器上的那种装法），这里两个口都显式收回到
# 127.0.0.1：本脚本是「自己电脑上跑一份」用的，没必要把口开给整个局域网。
cd "$(dirname "$0")" || exit 1

if [ ! -x ./play-agent ]; then
  echo "没找到可执行的 ./play-agent（要和本脚本放在同一层）。" >&2
  echo "把 macOS 版 play-agent 放进来再跑；第一次运行若被 Gatekeeper 拦住，" >&2
  echo "到「系统设置 → 隐私与安全性」里点「仍要打开」。" >&2
  exit 1
fi

./play-agent --listen 127.0.0.1:8181 --web-listen 127.0.0.1:8182 --web-dir ./bell-panel &
AGENT=$!
# 脚本退出（Ctrl+C、关终端）时把代理一起收掉，不留后台进程。
trap 'kill $AGENT 2>/dev/null' EXIT INT TERM

# 等它把两个口绑上再叫浏览器；绑不上代理自己会退出，下面 wait 立刻返回。
sleep 1

open "http://127.0.0.1:8182"

wait $AGENT
