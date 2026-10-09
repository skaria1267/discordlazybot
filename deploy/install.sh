#!/usr/bin/env bash
# LazyBot 一键部署：Docker 运行 bot，Nginx 反代到 Cloudflare 域名。
# 用法：curl -fsSL https://raw.githubusercontent.com/skaria1267/discordlazybot/main/deploy/install.sh -o install.sh && bash install.sh
set -euo pipefail

REPO_RAW="https://raw.githubusercontent.com/skaria1267/discordlazybot/main/deploy"
APP_DIR="/opt/discordlazybot"
SSL_DIR="/etc/nginx/ssl"

green() { printf '\033[32m%s\033[0m\n' "$*"; }
red() { printf '\033[31m%s\033[0m\n' "$*"; }
ask() { local __v; read -r -p "$1" __v </dev/tty; printf '%s' "$__v"; }

if [ "$(id -u)" -ne 0 ]; then red "请用 root 运行（先执行 sudo -i）"; exit 1; fi
command -v docker >/dev/null || { red "没有找到 docker"; exit 1; }
if docker compose version >/dev/null 2>&1; then DC="docker compose"
elif command -v docker-compose >/dev/null; then DC="docker-compose"
else red "没有找到 docker compose"; exit 1; fi

DOMAIN=""
while [ -z "$DOMAIN" ]; do
  DOMAIN=$(ask "后台域名（例如 bot.example.com）: ")
  DOMAIN=$(printf '%s' "$DOMAIN" | tr -d '[:space:]')
done

mkdir -p "$APP_DIR/data"
cd "$APP_DIR"
curl -fsSL "$REPO_RAW/docker-compose.yml" -o docker-compose.yml

if [ ! -f .env ]; then
  while true; do
    read -r -s -p "设置后台登录密码（至少 8 位，输入时不显示）: " PW </dev/tty; echo
    [ ${#PW} -ge 8 ] && break
    red "太短了，再来一次"
  done
  printf 'ADMIN_PASSWORD=%s\nTZ=Asia/Shanghai\n' "$PW" > .env
  chmod 600 .env
  green "密码已保存（之后可以在后台「设置」里修改）"
else
  green "已存在 .env，保留原来的密码"
fi

# ---- 证书（自签名，供 Cloudflare「完全」模式使用；「灵活」模式走 80 端口用不到）----
mkdir -p "$SSL_DIR"
if [ -s "$SSL_DIR/discordlazybot.pem" ] && [ -s "$SSL_DIR/discordlazybot.key" ]; then
  green "已存在证书，跳过"
else
  if ! command -v openssl >/dev/null; then
    if command -v apt-get >/dev/null; then apt-get update -y && apt-get install -y openssl
    elif command -v dnf >/dev/null; then dnf install -y openssl
    elif command -v yum >/dev/null; then yum install -y openssl; fi
  fi
  openssl req -x509 -nodes -newkey rsa:2048 -days 3650 \
    -keyout "$SSL_DIR/discordlazybot.key" -out "$SSL_DIR/discordlazybot.pem" \
    -subj "/CN=${DOMAIN}" >/dev/null 2>&1
  chmod 600 "$SSL_DIR/discordlazybot.key"
  green "已生成自签名证书"
fi

# ---- Nginx ----
if ! command -v nginx >/dev/null; then
  echo "安装 Nginx…"
  if command -v apt-get >/dev/null; then apt-get update -y && apt-get install -y nginx
  elif command -v dnf >/dev/null; then dnf install -y nginx
  elif command -v yum >/dev/null; then yum install -y nginx
  else red "无法自动安装 Nginx，请手动安装后重新运行"; exit 1; fi
fi
mkdir -p /etc/nginx/conf.d
curl -fsSL "$REPO_RAW/nginx.conf" | sed "s/__DOMAIN__/${DOMAIN}/g" > /etc/nginx/conf.d/discordlazybot.conf
if nginx -t; then
  systemctl enable nginx >/dev/null 2>&1 || true
  systemctl reload nginx 2>/dev/null || systemctl restart nginx
  green "Nginx 配置完成"
else
  red "Nginx 配置检查失败，请把上面的报错发给 Claude"; exit 1
fi

# ---- 启动 ----
$DC pull
$DC up -d

cat > /usr/local/bin/lazybot <<EOF
#!/usr/bin/env bash
cd $APP_DIR
case "\${1:-}" in
  update)  $DC pull && $DC up -d && docker image prune -f ;;
  logs)    $DC logs -f --tail 200 ;;
  restart) $DC restart ;;
  stop)    $DC stop ;;
  *) echo "用法：lazybot update | logs | restart | stop" ;;
esac
EOF
chmod +x /usr/local/bin/lazybot

sleep 3
if curl -fsS -o /dev/null "http://127.0.0.1:38761/"; then
  green "部署完成！打开 https://${DOMAIN} 登录后台。"
else
  red "容器好像没有正常启动，执行 lazybot logs 查看日志"
fi
echo "以后更新：lazybot update    查看日志：lazybot logs"
