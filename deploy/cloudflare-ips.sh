#!/usr/bin/env bash
# 在服务器上用 sudo 运行：取 Cloudflare 公布的 IP 段，
#   1. 写 nginx 的真实 IP 配置（/etc/nginx/snippets/cloudflare-realip.conf）：只有从这些地址来的请求，
#      才采信 CF-Connecting-IP 当用户的 IP；
#   2. 防火墙（ufw）的 80、443 只放行这些段：直接连服务器 IP 进不来，攻击只能打到 Cloudflare。
# Cloudflare 的 IP 段很少变；第一次装机时跑一次，以后每隔几个月或者 Cloudflare 通知变动时再跑。
#
#   sudo bash deploy/cloudflare-ips.sh

set -euo pipefail

if [[ $EUID -ne 0 ]]; then
  echo "要用 sudo 运行" >&2
  exit 1
fi

v4=$(curl -fsS --max-time 20 https://www.cloudflare.com/ips-v4)
v6=$(curl -fsS --max-time 20 https://www.cloudflare.com/ips-v6)
ranges=$(printf '%s\n%s\n' "$v4" "$v6" | sed '/^\s*$/d')

# 防止拿到的是错误页：每一行都要像一个网段，而且至少有十几段
count=$(printf '%s\n' "$ranges" | wc -l)
if [[ $count -lt 10 ]] || printf '%s\n' "$ranges" | grep -qvE '^[0-9a-fA-F:.]+/[0-9]+$'; then
  echo "取到的 IP 段不对，没有改动：" >&2
  printf '%s\n' "$ranges" >&2
  exit 1
fi

snippet=/etc/nginx/snippets/cloudflare-realip.conf
mkdir -p /etc/nginx/snippets
{
  echo "# 由 deploy/cloudflare-ips.sh 生成于 $(date -u +%Y-%m-%dT%H:%MZ)，不要手改"
  printf '%s\n' "$ranges" | sed 's/^/set_real_ip_from /; s/$/;/'
  echo "real_ip_header CF-Connecting-IP;"
} > "$snippet.new"
mv "$snippet.new" "$snippet"
echo "已写入 $snippet（$count 段）"

# 防火墙：先删掉上次加的（注释是 cloudflare），再按新的列表加
while true; do
  # 一条都没有时 grep 返回 1，不算出错
  num=$(ufw status numbered | { grep '# cloudflare' || true; } | head -1 | sed -E 's/^\[ *([0-9]+)\].*/\1/')
  [[ -z $num ]] && break
  ufw --force delete "$num" > /dev/null
done
while read -r cidr; do
  ufw allow proto tcp from "$cidr" to any port 80,443 comment cloudflare > /dev/null
done <<< "$ranges"
echo "防火墙：80、443 只放行 Cloudflare 的 $count 段"

if command -v nginx > /dev/null && [[ -f /etc/nginx/sites-enabled/bettertavern ]]; then
  nginx -t && systemctl reload nginx
fi
