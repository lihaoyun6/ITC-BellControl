@echo off
chcp 65001 >nul
rem 起播放代理，顺带把 bell-panel 当网页目录伺服出去，然后打开面板。
rem
rem 两个口别混：
rem   · 127.0.0.1:8181 —— 代理自己的 WebSocket 控制口（面板「全局设置 → 播放代理」
rem     默认就连这儿），不是网页；
rem   · 127.0.0.1:8182 —— --web-dir 开出来的静态托管口，面板网页在这儿。
cd /d "%~dp0"

if not exist "play-agent.exe" (
  echo 没找到 play-agent.exe（要和本脚本放在同一层）。
  echo 把 Windows 版 play-agent.exe 放进来再跑。
  pause
  exit /b 1
)

rem 浏览器放到另一个后台小窗里、晚两秒再开，等代理把两个口都绑上。
start "" /b cmd /c "timeout /t 2 /nobreak >nul & start http://127.0.0.1:8182"

rem 代理放在前台跑：Ctrl+C 或关掉这个窗口，它跟着一起停。
play-agent.exe --web-dir ".\bell-panel"

pause
