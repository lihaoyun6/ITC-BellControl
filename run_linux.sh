#!/bin/sh
# 起播放代理，顺带把 bell-panel 当网页目录伺服出去，然后打开面板。
#
# 两个口别混：
#   · 127.0.0.1:8181 —— 代理自己的 WebSocket 控制口（面板「全局设置 → 播放代理」
#     默认就连这儿），不是网页；
#   · 127.0.0.1:8182 —— --web-dir 开出来的静态托管口，面板网页在这儿。
cd "$(dirname "$0")" || exit 1

if [ ! -x ./play-agent ]; then
  echo "没找到可执行的 ./play-agent（要和本脚本放在同一层）。" >&2
  echo "把 Linux 版 play-agent 放进来再跑。" >&2
  exit 1
fi

./play-agent --web-dir ./bell-panel &
AGENT=$!
# 脚本退出（Ctrl+C、关终端）时把代理一起收掉，不留后台进程。
trap 'kill $AGENT 2>/dev/null' EXIT INT TERM

# 等它把两个口绑上再叫浏览器；绑不上代理自己会退出，下面 wait 立刻返回。
sleep 1

URL="http://127.0.0.1:8182"
if command -v xdg-open >/dev/null 2>&1; then
  xdg-open "$URL" >/dev/null 2>&1 &
elif [ -n "$BROWSER" ]; then
  "$BROWSER" "$URL" >/dev/null 2>&1 &
else
  echo "浏览器没自动打开，手动访问 $URL"
fi

wait $AGENT
