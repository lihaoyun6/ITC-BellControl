#!/bin/sh
cd "$(dirname "$0")" || exit 1

./dufs ./bell-panel -b 0.0.0.0 -p 82 --allow-upload --allow-delete --render-index -a '@/config.json:rw,/config.json.tmp:rw,/'
