#!/usr/bin/env bash
# =====================================================================
#  BDSM / SP 老虎机 · 一键部署 (Linux / macOS / Android-Termux)
#
#  用法:  bash install.sh
#  功能:  检查 Node.js → 选项目 → 自动生成 token → 启动 → 打印访问地址
#  停止:  kill $(cat bdsm-slot/app.pid sp-slot/app.pid 2>/dev/null)
# =====================================================================
set -euo pipefail

BOLD='\033[1m'; RED='\033[31m'; GRN='\033[32m'; YLW='\033[33m'; RST='\033[0m'
HERE="$(cd "$(dirname "$0")" && pwd)"

echo "${BOLD}══════════ 老虎机一键部署 ══════════${RST}"

# ---- 1. Node.js 检查 ----
if ! command -v node >/dev/null 2>&1; then
  echo "${RED}未检测到 Node.js (需要 >= 18)${RST}"
  if [ -n "${TERMUX_VERSION:-}" ]; then
    echo "Termux 用户请执行: pkg install nodejs"
  elif command -v apt >/dev/null 2>&1; then
    echo "Debian/Ubuntu 请执行: curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt install -y nodejs"
  elif command -v brew >/dev/null 2>&1; then
    echo "macOS 请执行: brew install node"
  fi
  exit 1
fi
NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]')
if [ "$NODE_MAJOR" -lt 18 ]; then
  echo "${RED}Node.js 版本过低 ($(node -v))，需要 >= 18${RST}"; exit 1
fi
echo "${GRN}✔ Node.js $(node -v)${RST}"

# ---- 2. 选项目 ----
APP=$(basename "$HERE")
TARGETS=("$APP")

# ---- 3. 逐个初始化 + 启动 ----
case "$APP" in bdsm-slot) DEFAULT_PORT=5060;; sp-slot) DEFAULT_PORT=5062;; *) DEFAULT_PORT=5060;; esac
for APP in "${TARGETS[@]}"; do
  DIR="$HERE/$APP"
  DEFAULT_PORT=$DEFAULT_PORT
  read -rp "$APP 端口 [回车=$DEFAULT_PORT] " IN_PORT
  PORT=${IN_PORT:-$DEFAULT_PORT}
  read -rp "$APP 是否允许局域网设备(手机)访问? [y/N] " LAN
  if [ "${LAN:-n}" = "y" ] || [ "${LAN:-n}" = "Y" ]; then HOST=0.0.0.0; else HOST=localhost; fi

  if [ ! -f "$DIR/server.js" ]; then echo "${RED}找不到 $DIR/server.js，跳过${RST}"; continue; fi

  # 生成 .env (已存在则保留用户的)
  if [ ! -f "$DIR/.env" ]; then
    TOKEN=$(node -p 'require("crypto").randomBytes(32).toString("base64url")')
    printf 'PORT=%s\nHOST=%s\n%s_TOKEN=%s\n' "$PORT" "$HOST" "$(echo "$APP" | tr 'a-z-' 'A-Z_' )" "$TOKEN" > "$DIR/.env"
    chmod 600 "$DIR/.env"
    echo "${GRN}✔ $APP/.env 已生成 (含随机 token)${RST}"
  else
    echo "${YLW}・$APP/.env 已存在，保留不动${RST}"
  fi

  # 停掉旧实例
  if [ -f "$DIR/app.pid" ]; then
    kill "$(cat "$DIR/app.pid")" 2>/dev/null || true
    rm -f "$DIR/app.pid"
  fi

  # 启动 (后台 + pid 文件)
  cd "$DIR"
  nohup node server.js > "app.log" 2>&1 &
  echo $! > "app.pid"
  cd "$HERE"
  sleep 1

  # 探活
  if kill -0 "$(cat "$DIR/app.pid")" 2>/dev/null; then
    # 本机访问地址
    LAN_IP=""
    if [ "$HOST" = "0.0.0.0" ]; then
      LAN_IP=$(ip -4 addr show scope global 2>/dev/null | grep -oP '(?<=inet\s)\d+(\.\d+){3}' | head -1 \
            || ifconfig 2>/dev/null | grep 'inet ' | grep -v localhost | awk '{print $2}' | head -1 \
            || hostname -I 2>/dev/null | awk '{print $1}')
    fi
    TOKEN=$(grep -oP '(?<==)[A-Za-z0-9_-]+$' "$DIR/.env" | tail -1)
    echo "${GRN}✔ $APP 已启动 (pid $(cat "$DIR/app.pid"))${RST}"
    echo "   本机:   http://localhost:$PORT/"
    [ -n "$LAN_IP" ] && echo "   局域网: http://$LAN_IP:$PORT/  (手机同 WiFi 可开网页)"
    echo "   MCP:    http://localhost:$PORT/mcp  (Authorization: Bearer $TOKEN)"
    [ -n "$LAN_IP" ] && echo "   MCP(局域网): http://$LAN_IP:$PORT/mcp"
  else
    echo "${RED}✘ $APP 启动失败，看 $DIR/app.log${RST}"
  fi
done

echo
echo "${BOLD}完成。${RST}"
echo "停止:  kill \$(cat */app.pid 2>/dev/null)"
echo "日志:  */app.log"
echo "改池子: 编辑 data/pools.json，保存即生效 (无需重启)"
echo
echo "开机自启（可选）:"
if command -v systemctl >/dev/null 2>&1 && [ -n "${TERMUX_VERSION:-}" = "" ]; then
  echo "  Linux: 参考 README 的 systemd 示例，把 WorkingDirectory 指向本目录"
elif [ -n "${TERMUX_VERSION:-}" ]; then
  echo "  Termux: 装 Termux:Boot 插件后，把启动命令放进 ~/.termux/boot/"
elif command -v launchctl >/dev/null 2>&1; then
  echo "  macOS: 参考 README 的 launchd 说明"
fi
