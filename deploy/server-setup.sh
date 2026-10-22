#!/usr/bin/env bash
# 新服务器第一次装机（Ubuntu 24.04，1 GB 内存）。用有 sudo 权限的普通用户运行，可以重复运行：
#
#   scp deploy/server-setup.sh deploy/cloudflare-ips.sh 用户@服务器:~
#   ssh 用户@服务器 'bash server-setup.sh'
#
# 做的事（详见 docs/ops.md 的“第一次部署”）：
#   1. 装 Docker（Ubuntu 自带的软件源）、nginx；当前用户加进 docker 组
#   2. Docker 的日志限量（每个容器最多 5 个 10 MB 的文件）
#   3. 2 GB 交换空间（1 GB 内存跑 api、worker、Postgres 很紧，内存不够时先用交换空间顶上，不至于被系统杀进程）
#   4. 目录 /srv/bettertavern（compose 文件、.env、网页、备份）
#   5. Cloudflare 源站证书的私钥和证书请求（CSR）：私钥只在这台服务器上，把打印出来的 CSR 贴到 Cloudflare 后台
#   6. 防火墙：只开 SSH；80、443 只放行 Cloudflare（cloudflare-ips.sh）
# nginx 的站点配置要等证书放好以后由部署脚本装（scripts/deploy.sh）。

set -euo pipefail

user=$(id -un)
here=$(cd "$(dirname "$0")" && pwd)

echo "== 1. 安装 Docker 和 nginx"
sudo apt-get update -q
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -q docker.io docker-compose-v2 nginx ufw rsync curl openssl
sudo usermod -aG docker "$user"
sudo systemctl enable --now docker nginx

echo "== 2. Docker 日志限量"
if [[ ! -f /etc/docker/daemon.json ]]; then
  echo '{"log-driver": "json-file", "log-opts": {"max-size": "10m", "max-file": "5"}}' | sudo tee /etc/docker/daemon.json > /dev/null
  sudo systemctl restart docker
fi

echo "== 3. 交换空间"
if ! sudo swapon --show | grep -q /swapfile; then
  sudo fallocate -l 2G /swapfile
  sudo chmod 600 /swapfile
  sudo mkswap /swapfile > /dev/null
  sudo swapon /swapfile
  grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab > /dev/null
fi
# 内存还够时尽量不用交换空间
echo 'vm.swappiness=10' | sudo tee /etc/sysctl.d/90-bettertavern.conf > /dev/null
sudo sysctl -q --system

echo "== 4. 目录"
sudo mkdir -p /srv/bettertavern/web /srv/bettertavern/backups
sudo chown -R "$user:$user" /srv/bettertavern
chmod 700 /srv/bettertavern/backups

echo "== 5. 源站证书的私钥和证书请求"
sudo mkdir -p /etc/ssl/bettertavern
sudo chmod 700 /etc/ssl/bettertavern
if [[ ! -f /etc/ssl/bettertavern/origin.key ]]; then
  sudo openssl req -new -newkey rsa:2048 -nodes \
    -keyout /etc/ssl/bettertavern/origin.key \
    -out /etc/ssl/bettertavern/origin.csr \
    -subj "/CN=bettertavern.com" \
    -addext "subjectAltName=DNS:bettertavern.com,DNS:*.bettertavern.com" 2> /dev/null
  sudo chmod 600 /etc/ssl/bettertavern/origin.key
fi
if [[ ! -f /etc/ssl/bettertavern/origin.pem ]]; then
  echo "把下面这段 CSR 贴到 Cloudflare：SSL/TLS › Origin Server › Create Certificate ›"
  echo "选 Use my private key and CSR，主机名填 bettertavern.com 和 *.bettertavern.com。"
  echo "签好的证书保存到 /etc/ssl/bettertavern/origin.pem（docs/ops.md 有命令）。"
  sudo cat /etc/ssl/bettertavern/origin.csr
fi

echo "== 6. 防火墙"
sudo ufw allow OpenSSH > /dev/null
sudo bash "$here/cloudflare-ips.sh"
sudo ufw --force enable > /dev/null
sudo ufw status | head -5

# 默认站点会占着 80 端口，换成我们的配置之前先去掉
sudo rm -f /etc/nginx/sites-enabled/default

echo "装机完成。重新登录一次 SSH，docker 组才对当前用户生效。"
