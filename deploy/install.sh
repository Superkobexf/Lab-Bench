#!/usr/bin/env bash
#
# Lab Bench 一键部署脚本
#
#   sudo bash deploy/install.sh
#
# 覆盖范围：装系统包、配 swap、建用户和目录、装 Python 依赖、
# 生成 systemd 与 nginx 配置、申请证书、挂备份 cron、建管理员账号。
#
# 覆盖不了：ICP 备案（法定流程，1-3 周人工审核）、购买服务器和域名、
# 域名解析。这三件必须你自己先做完，脚本不碰你的阿里云 AccessKey。
#
# 可以重复运行：已经做过的步骤会跳过，改配置重跑一次即可，不会动数据库。

set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DATA_DIR="${LAB_BENCH_DATA_DIR:-/var/lib/lab-bench}"
SERVICE_USER="${LAB_BENCH_USER:-labbench}"
PORT="${LAB_BENCH_PORT:-5299}"
VENV="$REPO/.venv"

BOLD=$'\033[1m'; DIM=$'\033[2m'; RED=$'\033[31m'; GREEN=$'\033[32m'
YELLOW=$'\033[33m'; RESET=$'\033[0m'

step()  { printf '\n%s▸ %s%s\n' "$BOLD" "$1" "$RESET"; }
info()  { printf '  %s\n' "$1"; }
skip()  { printf '  %s· %s%s\n' "$DIM" "$1" "$RESET"; }
warn()  { printf '  %s! %s%s\n' "$YELLOW" "$1" "$RESET"; }
die()   { printf '\n%s✗ %s%s\n\n' "$RED" "$1" "$RESET" >&2; exit 1; }
done_() { printf '  %s✓ %s%s\n' "$GREEN" "$1" "$RESET"; }

# 有没有可交互的终端。管道运行（curl | bash）和 CI 里都没有，
# 这时不能傻等 /dev/tty，要给出能照做的替代命令。
HAS_TTY=no
[ -e /dev/tty ] && (: >/dev/tty) 2>/dev/null && HAS_TTY=yes

ask() { # ask <提示> <默认值>
  local prompt="$1" default="${2:-}" reply
  if [ "$HAS_TTY" = no ]; then printf '%s' "$default"; return; fi
  if [ -n "$default" ]; then
    read -r -p "  $prompt [$default]: " reply </dev/tty || true
    printf '%s' "${reply:-$default}"
  else
    read -r -p "  $prompt: " reply </dev/tty || true
    printf '%s' "$reply"
  fi
}

confirm() { # confirm <提示>  -> 返回 0 表示同意
  local reply
  [ "$HAS_TTY" = no ] && return 1
  read -r -p "  $1 [y/N]: " reply </dev/tty || true
  [[ "$reply" =~ ^[Yy]$ ]]
}

# ── 0. 环境检查 ─────────────────────────────────────────────

step "环境检查"

[ "$(id -u)" -eq 0 ] || die "需要 root 权限。请用： sudo bash deploy/install.sh"
[ -f "$REPO/server/app.py" ] || die "在 $REPO 下找不到 server/app.py，请在仓库根目录运行。"

if   command -v apt-get >/dev/null 2>&1; then PKG=apt
elif command -v dnf     >/dev/null 2>&1; then PKG=dnf
elif command -v yum     >/dev/null 2>&1; then PKG=yum
else die "只认得 apt / dnf / yum。其它发行版请按 deploy/README.md 手动装。"
fi

OS_NAME="$(. /etc/os-release 2>/dev/null && echo "${PRETTY_NAME:-未知}")"
# 容器里 /proc/meminfo 读到的是宿主机内存，cgroup 限制不反映在这里；
# 真实虚拟机上没有这个问题。留个覆盖口子，便于测试和容器化部署。
MEM_MB="${LAB_BENCH_MEM_MB:-$(awk '/MemTotal/ {printf "%d", $2/1024}' /proc/meminfo)}"
CPUS=$(nproc)
info "系统    ： $OS_NAME"
info "包管理器： $PKG"
info "配置    ： ${CPUS} 核 / ${MEM_MB} MB 内存"
info "仓库    ： $REPO"

[ "$MEM_MB" -ge 1800 ] || warn "内存不足 2GB，跑起来会很吃力，强烈建议升到 2C2G。"

# ── 0.5 访问方式 ────────────────────────────────────────────
# 必须在写 systemd 之前问：有没有 HTTPS 决定了会话 Cookie 能不能带 Secure。
# 浏览器不会在明文 HTTP 上保存 Secure Cookie——写错了的话用户会
# "登录成功后立刻被弹回登录页"，而且很难查。

step "访问方式"

DOMAIN="${LAB_BENCH_DOMAIN:-}"
if [ -z "$DOMAIN" ] && [ "$HAS_TTY" = yes ]; then
  info "填域名就配 HTTPS；直接回车则用 IP 裸跑（仅供测试）。"
  DOMAIN="$(ask '已备案并已解析到本机的域名（可留空）' '')"
fi
if [ -n "$DOMAIN" ]; then
  info "将以 https://$DOMAIN 提供服务"
else
  warn "IP 直连模式：没有 TLS，口令和会话都是明文过网络。"
  warn "不要让学生在这个模式下输真实口令。"
fi

# ── 1. swap ─────────────────────────────────────────────────

step "配置 swap"

CUR_SWAP=$(awk '/SwapTotal/ {printf "%d", $2/1024}' /proc/meminfo)
if [ "$CUR_SWAP" -ge 1500 ]; then
  skip "已有 ${CUR_SWAP} MB swap，跳过"
elif [ "$MEM_MB" -ge 7000 ]; then
  skip "内存 ${MEM_MB} MB 足够，不配 swap"
else
  # 阿里云的系统盘默认没有 swap。OCR 峰值撞上来时内核会随机杀进程，
  # 被杀的很可能是 uvicorn 或 nginx，而不是真正吃内存的那个。
  if [ -f /swapfile ]; then
    warn "/swapfile 已存在但没启用，尝试启用"
  else
    info "创建 2GB /swapfile…"
    fallocate -l 2G /swapfile 2>/dev/null || dd if=/dev/zero of=/swapfile bs=1M count=2048 status=none
    chmod 600 /swapfile
    mkswap /swapfile >/dev/null
  fi
  swapon /swapfile 2>/dev/null || true
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
  grep -q '^vm.swappiness' /etc/sysctl.conf || echo 'vm.swappiness=10' >> /etc/sysctl.conf
  sysctl -q -p >/dev/null 2>&1 || true
  NEW_SWAP=$(awk '/SwapTotal/ {printf "%d", $2/1024}' /proc/meminfo)
  # 只报「已配置」是不够的：容器里 swapon 会静默失败，读回来还是宿主机的数字。
  if [ "$NEW_SWAP" -gt "$CUR_SWAP" ]; then
    done_ "swap 已配置（${NEW_SWAP} MB）"
  else
    warn "swap 没有生效（仍是 ${NEW_SWAP} MB）。容器环境下属正常，"
    warn "真实虚拟机上出现这种情况请手动检查： swapon -a && free -h"
  fi
fi

# ── 2. 系统包 ───────────────────────────────────────────────

step "安装系统包"

PKGS_APT="nginx python3 python3-venv python3-pip sqlite3 curl ca-certificates"
PKGS_RPM="nginx python3 python3-pip sqlite curl ca-certificates"

if [ "$PKG" = apt ]; then
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq
  # shellcheck disable=SC2086
  apt-get install -y -qq $PKGS_APT >/dev/null
else
  # shellcheck disable=SC2086
  $PKG install -y -q $PKGS_RPM >/dev/null
fi
done_ "nginx / python3 / sqlite3 就绪（$(python3 -V 2>&1)）"

PY_MINOR=$(python3 -c 'import sys; print(sys.version_info[1])')
[ "$PY_MINOR" -ge 9 ] || die "需要 Python 3.9 以上，当前是 3.$PY_MINOR。"

# ── 3. 用户与目录 ───────────────────────────────────────────

step "创建服务账号与数据目录"

if id "$SERVICE_USER" >/dev/null 2>&1; then
  skip "用户 $SERVICE_USER 已存在"
else
  useradd -r -s /usr/sbin/nologin -d "$DATA_DIR" "$SERVICE_USER" 2>/dev/null \
    || useradd -r -s /sbin/nologin -d "$DATA_DIR" "$SERVICE_USER"
  done_ "已创建用户 $SERVICE_USER"
fi

mkdir -p "$DATA_DIR/uploads"
chown -R "$SERVICE_USER:$SERVICE_USER" "$DATA_DIR"
chmod 750 "$DATA_DIR"
# 仓库本身保持只读：应用只往 DATA_DIR 写
chown -R root:root "$REPO" 2>/dev/null || true
done_ "数据目录 $DATA_DIR"

# ── 4. Python 依赖 ──────────────────────────────────────────

step "安装 Python 依赖"

WANT_OCR=yes
if [ "$MEM_MB" -lt 1800 ]; then
  warn "内存偏小，默认跳过 OCR（数字版合同不受影响，仍能自动抽取）"
  WANT_OCR=no
elif [ -t 0 ] && [ -z "${LAB_BENCH_INSTALL_OCR:-}" ]; then
  confirm "安装扫描件 OCR 引擎？（约几百 MB，只处理电子版合同的话可以不装）" || WANT_OCR=no
elif [ "${LAB_BENCH_INSTALL_OCR:-yes}" = no ]; then
  WANT_OCR=no
fi

[ -d "$VENV" ] || python3 -m venv "$VENV"
"$VENV/bin/pip" install -q --upgrade pip

REQ="$REPO/server/requirements.txt"
if [ "$WANT_OCR" = yes ]; then
  info "安装全部依赖（含 OCR），这一步比较慢…"
  "$VENV/bin/pip" install -q -r "$REQ"
else
  info "安装核心依赖（不含 OCR）…"
  grep -viE '^(rapidocr|paddleocr|paddlepaddle|pymupdf|numpy|pillow)' "$REQ" \
    | "$VENV/bin/pip" install -q -r /dev/stdin
fi
done_ "依赖安装完成"

# ── 5. systemd ──────────────────────────────────────────────

step "配置 systemd 服务"

# argon2 的内存开销是「每次哈希」的：10 人同时登录就是 10 倍。
# 按机器内存定档，不能照抄库的默认值。
if   [ "$MEM_MB" -ge 7000 ]; then ARGON2_MB=46; OCR_MEM=3000
elif [ "$MEM_MB" -ge 3500 ]; then ARGON2_MB=32; OCR_MEM=2000
else                              ARGON2_MB=19; OCR_MEM=1200
fi
info "argon2 内存 ${ARGON2_MB} MB/次 · OCR 子进程上限 ${OCR_MEM} MB"

# 证书申请失败时要能把 Secure 降回 0 再重写一遍，所以做成函数
write_unit() { # write_unit <secure_cookie 0|1>
cat > /etc/systemd/system/lab-bench.service <<EOF
# 由 deploy/install.sh 生成。手动改完记得 systemctl daemon-reload。
[Unit]
Description=Lab Bench 课题组管理台
After=network.target

[Service]
Type=simple
User=$SERVICE_USER
Group=$SERVICE_USER
WorkingDirectory=$REPO/server

Environment="LAB_BENCH_DB=$DATA_DIR/lab.db"
Environment="LAB_BENCH_UPLOADS=$DATA_DIR/uploads"
Environment="LAB_BENCH_SECURE_COOKIE=$1"
Environment="LAB_BENCH_ARGON2_MEMORY_MB=$ARGON2_MB"
Environment="LAB_BENCH_OCR_MEM_MB=$OCR_MEM"
Environment="LAB_BENCH_OCR_TIMEOUT=300"
Environment="LAB_BENCH_OCR_DPI=200"
Environment="LAB_BENCH_OCR_MAX_PAGES=12"

ExecStart=$VENV/bin/uvicorn app:app \\
    --host 127.0.0.1 --port $PORT --workers 1 \\
    --proxy-headers --forwarded-allow-ips=127.0.0.1

Restart=on-failure
RestartSec=5

NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=$DATA_DIR
ProtectKernelTunables=true
ProtectControlGroups=true
RestrictSUIDSGID=true

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
}

if [ -n "$DOMAIN" ]; then SECURE=1; else SECURE=0; fi
write_unit "$SECURE"
done_ "已写入 systemd 单元（Secure Cookie = $SECURE）"

# ── 6. 管理员账号 ───────────────────────────────────────────

step "管理员账号"

NEED_ADMIN=no
export LAB_BENCH_DB="$DATA_DIR/lab.db" LAB_BENCH_UPLOADS="$DATA_DIR/uploads"
HAS_ADMIN=$(sudo -u "$SERVICE_USER" \
  LAB_BENCH_DB="$DATA_DIR/lab.db" \
  "$VENV/bin/python" "$REPO/server/manage.py" listusers 2>/dev/null \
  | grep -c ' pi ' || true)

if [ "${HAS_ADMIN:-0}" -gt 0 ]; then
  skip "已有导师账号，跳过（要改口令用 manage.py passwd）"
else
  if [ "$HAS_TTY" = yes ]; then
    info "系统不带任何默认账号，现在建第一个导师账号。"
    info "口令是交互式输入的，不会留在 shell history 里。"
    sudo -u "$SERVICE_USER" \
      LAB_BENCH_DB="$DATA_DIR/lab.db" \
      "$VENV/bin/python" "$REPO/server/manage.py" createadmin </dev/tty
  else
    # 管道运行时没有终端可以读口令。不能在这里退出——前面的活都白做了。
    NEED_ADMIN=yes
    warn "当前没有可交互的终端，跳过建账号。装完后请手动执行："
    warn "  sudo -u $SERVICE_USER LAB_BENCH_DB=$DATA_DIR/lab.db \\"
    warn "    $VENV/bin/python $REPO/server/manage.py createadmin"
  fi
fi

# ── 7. 起服务 ───────────────────────────────────────────────

step "启动服务"

systemctl enable -q lab-bench 2>/dev/null || true
systemctl restart lab-bench
sleep 3

if ! systemctl is-active --quiet lab-bench; then
  journalctl -u lab-bench -n 30 --no-pager || true
  die "服务没起来，日志见上。"
fi
CODE=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/" || echo 000)
[ "$CODE" = 200 ] || die "服务在跑但本地访问返回 $CODE。查 journalctl -u lab-bench"
done_ "服务已启动，本地 127.0.0.1:$PORT 返回 200"

# ── 8. nginx 与证书 ─────────────────────────────────────────

step "配置 nginx"

NGINX_CONF_DIR=/etc/nginx/conf.d
mkdir -p "$NGINX_CONF_DIR"
# Debian 系默认站点会抢 80 端口的 default_server
[ -e /etc/nginx/sites-enabled/default ] && rm -f /etc/nginx/sites-enabled/default

if [ -n "$DOMAIN" ]; then
  sed -e "s|lab\.example\.edu\.cn|$DOMAIN|g" \
      -e "s|/opt/lab-bench|$REPO|g" \
      -e "s|server 127\.0\.0\.1:5299;|server 127.0.0.1:$PORT;|" \
      "$REPO/deploy/nginx.conf" > "$NGINX_CONF_DIR/lab-bench.conf"
  info "已按域名 $DOMAIN 生成配置"
else
  cat > "$NGINX_CONF_DIR/lab-bench.conf" <<EOF
# IP 直连模式，没有 TLS。仅供测试，不要让学生在上面输真实口令。
upstream lab_bench { server 127.0.0.1:$PORT; keepalive 16; }

server {
    listen 80 default_server;
    server_name _;
    root $REPO;
    client_max_body_size 40m;

    add_header X-Content-Type-Options "nosniff" always;
    add_header X-Frame-Options "DENY" always;

    location = / { try_files /index.html =404; }
    location ~* ^/(app|api|i18n)\.js\$ { expires 1h; }
    location = /styles.css { expires 1h; }
    location /uploads/ { return 404; }

    location /api/ {
        proxy_pass         http://lab_bench;
        proxy_http_version 1.1;
        proxy_set_header   Host              \$host;
        proxy_set_header   X-Real-IP         \$remote_addr;
        proxy_set_header   X-Forwarded-For   \$proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto \$scheme;
        proxy_set_header   Connection        "";
        proxy_read_timeout 180s;
    }
}
EOF
  warn "IP 直连模式：没有 HTTPS，会话 Cookie 和口令都是明文。"
fi

# 登录限速的 zone 必须定义在 http{} 里
if ! grep -rq 'zone=login' /etc/nginx/nginx.conf /etc/nginx/conf.d/ 2>/dev/null; then
  sed -i '0,/^http {/{s|^http {|http {\n    limit_req_zone $binary_remote_addr zone=login:10m rate=12r/m;|}' \
    /etc/nginx/nginx.conf
fi

if [ -n "$DOMAIN" ]; then
  # 证书还没申请时，nginx 会因为找不到证书文件起不来，先把 TLS 段摘掉
  if [ ! -f /etc/nginx/ssl/lab-bench.pem ] && [ ! -d "/etc/letsencrypt/live/$DOMAIN" ]; then
    info "证书还没有，先申请 Let's Encrypt 证书…"
    if [ "$PKG" = apt ]; then apt-get install -y -qq certbot python3-certbot-nginx >/dev/null
    else $PKG install -y -q certbot python3-certbot-nginx >/dev/null || true; fi

    # 先放一个纯 HTTP 的临时配置，好让 certbot 完成校验
    cat > "$NGINX_CONF_DIR/lab-bench.conf" <<EOF
server {
    listen 80;
    server_name $DOMAIN;
    root $REPO;
    location / { try_files \$uri /index.html =404; }
}
EOF
    nginx -t -q && systemctl reload nginx
    EMAIL="$(ask '证书到期提醒邮箱' "admin@$DOMAIN")"
    if certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos -m "$EMAIL" --redirect; then
      done_ "证书申请成功，已自动配置续期"
      # 用完整配置覆盖 certbot 生成的简版，再让 certbot 把证书路径补回来
      sed -e "s|lab\.example\.edu\.cn|$DOMAIN|g" \
          -e "s|/opt/lab-bench|$REPO|g" \
          -e "s|server 127\.0\.0\.1:5299;|server 127.0.0.1:$PORT;|" \
          -e "s|/etc/nginx/ssl/lab-bench.pem|/etc/letsencrypt/live/$DOMAIN/fullchain.pem|" \
          -e "s|/etc/nginx/ssl/lab-bench.key|/etc/letsencrypt/live/$DOMAIN/privkey.pem|" \
          "$REPO/deploy/nginx.conf" > "$NGINX_CONF_DIR/lab-bench.conf"
    else
      warn "证书申请失败。常见原因：域名没解析到本机、80 端口没放行、或域名未备案。"
      warn "先保留 HTTP 配置，解决后重跑本脚本即可。"
      # 没有 TLS 却带着 Secure Cookie，浏览器会拒绝保存，
      # 表现为"登录成功后立刻被弹回登录页"。降回去并重启。
      write_unit 0
      systemctl restart lab-bench
      warn "已把 Secure Cookie 降为 0，否则登录会一直失败。拿到证书后重跑脚本会自动改回。"
    fi
  else
    skip "已有证书，跳过申请"
  fi
fi

nginx -t -q || die "nginx 配置有误，见上面的报错。"
systemctl enable -q nginx 2>/dev/null || true
systemctl reload nginx 2>/dev/null || systemctl restart nginx
done_ "nginx 已生效"

# ── 9. 备份 ─────────────────────────────────────────────────

step "配置每日备份"

install -m 755 "$REPO/deploy/backup.sh" /usr/local/bin/lab-bench-backup
CRON_LINE="0 3 * * * LAB_BENCH_DB=$DATA_DIR/lab.db LAB_BENCH_UPLOADS=$DATA_DIR/uploads /usr/local/bin/lab-bench-backup >> /var/log/lab-bench-backup.log 2>&1"
if crontab -l 2>/dev/null | grep -q lab-bench-backup; then
  skip "备份 cron 已存在"
else
  (crontab -l 2>/dev/null; echo "$CRON_LINE") | crontab -
  done_ "每天 03:00 备份到 /var/backups/lab-bench"
fi
warn "备份默认留在本机，机器挂了就一起没了。建议同步一份到 OSS。"

# ── 10. 自检 ────────────────────────────────────────────────

step "环境自检"

sudo -u "$SERVICE_USER" \
  LAB_BENCH_DB="$DATA_DIR/lab.db" \
  LAB_BENCH_UPLOADS="$DATA_DIR/uploads" \
  LAB_BENCH_ARGON2_MEMORY_MB="$ARGON2_MB" \
  LAB_BENCH_OCR_MEM_MB="$OCR_MEM" \
  "$VENV/bin/python" "$REPO/server/manage.py" checkenv || true

# ── 完成 ────────────────────────────────────────────────────

printf '\n%s部署完成%s\n\n' "$BOLD" "$RESET"
if [ "$NEED_ADMIN" = yes ]; then
  warn "还没有管理员账号——在建好之前，所有接口都会返回 503。"
  warn "执行： sudo -u $SERVICE_USER LAB_BENCH_DB=$DATA_DIR/lab.db $VENV/bin/python $REPO/server/manage.py createadmin"
  printf '\n'
fi
if [ -n "$DOMAIN" ]; then
  info "访问： https://$DOMAIN"
else
  IP="$(curl -s --max-time 5 https://api.ipify.org 2>/dev/null || echo '你的公网IP')"
  info "访问： http://$IP"
  warn "记得在轻量服务器的「防火墙」或 ECS 的「安全组」放行 80 端口。"
fi
cat <<EOF

  常用命令
    systemctl status lab-bench        看服务状态
    journalctl -u lab-bench -f        看实时日志
    systemctl restart lab-bench       重启

    $VENV/bin/python $REPO/server/manage.py listusers
    $VENV/bin/python $REPO/server/manage.py passwd <用户名>
    $VENV/bin/python $REPO/server/manage.py importjson <备份.json>
  （这些命令前面要加 sudo -u $SERVICE_USER LAB_BENCH_DB=$DATA_DIR/lab.db）

  上线前请对一遍 deploy/README.md 末尾的检查清单。

EOF
