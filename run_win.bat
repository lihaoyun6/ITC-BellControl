@echo off
cd /d "%~dp0"

dufs.exe .\bell-panel -b 0.0.0.0 -p 82 --allow-upload --allow-delete --render-index -a "@/config.json:rw,/config.json.tmp:rw,/"

pause