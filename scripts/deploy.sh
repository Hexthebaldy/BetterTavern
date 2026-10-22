#!/usr/bin/env bash
# 把当前提交部署到线上（bettertavern.com）。在自己电脑的仓库根目录运行：
#
#   BT_DEPLOY_HOST=用户@服务器 scripts/deploy.sh [--no-backup] [--skip-web] [--allow-dirty]
#
# 前提：这个提交已经推到 GitHub，GitHub Actions 的“构建镜像”已经跑完（镜像标签 sha-<提交号前 12 位>）；
# 服务器按 docs/ops.md 的“第一次部署”装好，/srv/bettertavern/.env 已经写好。
#
# 步骤（任何一步失败都会停下；api 重启以后起不来会自动回到上一个版本）：
#   1. 本机构建网页（apps/web/dist）
#   2. 服务器拉这个提交的镜像（拉不到说明 CI 还没构建好，什么都不改）
#   3. 传 compose 文件、nginx 配置和网页的静态文件（旧的静态文件不删，开着旧页面的人还能加载）
#   4. 备份数据库（pg_dump，只留最近 3 份；--no-backup 跳过）
#   5. 跑迁移，换成新镜像重启 api 和 worker，等 /health 报出新的提交号
#   6. 换上新的 index.html（网页切到新版本），从外网检查一次 https://bettertavern.com/health
#
# 脚本里没有服务器地址和密钥：地址从 BT_DEPLOY_HOST 读，密钥只在服务器的 .env 里。

set -euo pipefail

IMAGE_REPO=${BT_IMAGE_REPO:-ghcr.io/hexthebaldy/bettertavern-server}
SITE=${BT_SITE:-https://bettertavern.com}
REMOTE_DIR=/srv/bettertavern
backup=1
web=1
allow_dirty=0

for arg in "$@"; do
  case $arg in
    --no-backup) backup=0 ;;
    --skip-web) web=0 ;;
    --allow-dirty) allow_dirty=1 ;;
    -h | --help)
      sed -n '2,20p' "$0"
      exit 0
      ;;
    *)
      echo "不认识的参数：$arg" >&2
      exit 2
      ;;
  esac
done

host=${BT_DEPLOY_HOST:?请设置 BT_DEPLOY_HOST，例如 BT_DEPLOY_HOST=linuxuser@服务器IP}
root=$(git rev-parse --show-toplevel)
cd "$root"

if [[ $allow_dirty -eq 0 && -n $(git status --porcelain) ]]; then
  echo "有没提交的改动：网页会按工作区构建，和镜像对不上。先提交，或者加 --allow-dirty" >&2
  exit 1
fi
sha=$(git rev-parse --short=12 HEAD)
image="$IMAGE_REPO:sha-$sha"
if ! git branch -r --contains HEAD | grep -q .; then
  echo "这个提交还没推到 GitHub，CI 不会有它的镜像。先 git push" >&2
  exit 1
fi

step() { printf '\n== %s\n' "$*"; }
# 一次部署里的多次 ssh、scp、rsync 共用一条连接
ssh_opts=(-o BatchMode=yes -o ControlMaster=auto -o "ControlPath=$HOME/.ssh/bt-deploy-%C" -o ControlPersist=60)
remote() { ssh "${ssh_opts[@]}" "$host" "$@"; }
upload() { scp -q "${ssh_opts[@]}" "$1" "$host:$2"; }
sync_dir() { rsync -a -e "ssh ${ssh_opts[*]}" "$@"; }

if [[ $web -eq 1 ]]; then
  step "1. 构建网页"
  npm run build --workspace apps/web > /dev/null
fi

step "2. 拉镜像 $image"
if ! remote "docker pull -q '$image'"; then
  echo "拉不到镜像：GitHub Actions 还没构建好这个提交，或者镜像仓库不公开（docs/ops.md）" >&2
  exit 1
fi

step "3. 上传配置和静态文件"
remote "test -f $REMOTE_DIR/.env" || {
  echo "服务器上没有 $REMOTE_DIR/.env，先按 docs/ops.md 的“第一次部署”写好" >&2
  exit 1
}
upload deploy/compose.prod.yml "$REMOTE_DIR/compose.yml"
upload deploy/nginx.bettertavern.conf "$REMOTE_DIR/nginx.conf"
upload deploy/cloudflare-ips.sh "$REMOTE_DIR/cloudflare-ips.sh"
# nginx 配置有变化、或者还没启用时才装：先检查语法，不对就换回原来的（第一次装就撤掉，不留坏配置）
remote "set -e
  site=/etc/nginx/sites-available/bettertavern
  if ! sudo cmp -s $REMOTE_DIR/nginx.conf \$site || [ ! -L /etc/nginx/sites-enabled/bettertavern ]; then
    had_old=0
    if [ -f \$site ]; then sudo cp \$site \$site.bak; had_old=1; fi
    sudo install -m 644 $REMOTE_DIR/nginx.conf \$site
    sudo ln -sf \$site /etc/nginx/sites-enabled/bettertavern
    if sudo nginx -t 2>/dev/null; then
      sudo systemctl reload nginx && echo 'nginx 配置已更新'
    else
      sudo nginx -t || true
      if [ \$had_old = 1 ]; then sudo mv \$site.bak \$site; else sudo rm -f /etc/nginx/sites-enabled/bettertavern; fi
      echo 'nginx 配置有错，已经换回原来的' >&2
      exit 1
    fi
  fi"
if [[ $web -eq 1 ]]; then
  # 带哈希的文件先传，旧的不删；index.html 等到新的 api 起来以后再换
  sync_dir apps/web/dist/assets/ "$host:$REMOTE_DIR/web/assets/"
fi

step "4. 备份数据库"
# compose 文件要求有 BT_IMAGE；第一次部署时 .env 里还没有，先用这次的镜像顶上（不改 .env）
remote "cd $REMOTE_DIR && BT_IMAGE='$image' docker compose up -d --wait postgres > /dev/null"
if [[ $backup -eq 1 ]]; then
  remote "set -euo pipefail
    cd $REMOTE_DIR
    file=backups/pre-\$(date -u +%Y%m%dT%H%M%SZ)-$sha.dump
    BT_IMAGE='$image' docker compose exec -T postgres pg_dump -U bettertavern -Fc bettertavern > \"\$file\"
    chmod 600 \"\$file\"
    echo \"已备份：$REMOTE_DIR/\$file（\$(du -h \"\$file\" | cut -f1)）\"
    ls -1t backups/pre-*.dump | tail -n +4 | xargs -r rm --"
else
  echo "跳过（--no-backup）"
fi

step "5. 迁移数据库，换成新版本"
previous=$(remote "grep -E '^BT_IMAGE=' $REMOTE_DIR/.env | cut -d= -f2-" || true)
set_image() {
  remote "cd $REMOTE_DIR && if grep -q '^BT_IMAGE=' .env; then sed -i 's|^BT_IMAGE=.*|BT_IMAGE=$1|' .env; else echo 'BT_IMAGE=$1' >> .env; fi"
}
set_image "$image"
if ! remote "cd $REMOTE_DIR && docker compose run --rm migrate"; then
  echo "迁移失败：api 还在跑旧版本，没有重启。.env 里的 BT_IMAGE 已经换回去" >&2
  [[ -n $previous ]] && set_image "$previous"
  exit 1
fi
remote "cd $REMOTE_DIR && docker compose up -d --remove-orphans api worker"

healthy=0
for _ in $(seq 1 30); do
  if remote "curl -fsS --max-time 3 http://127.0.0.1:8000/health" 2> /dev/null | grep -q "\"build\":\"$sha\""; then
    healthy=1
    break
  fi
  sleep 2
done
if [[ $healthy -eq 0 ]]; then
  echo "新版本 60 秒内没有起来，最近的日志：" >&2
  remote "cd $REMOTE_DIR && docker compose logs --tail 60 api" >&2 || true
  if [[ -n $previous ]]; then
    echo "换回上一个版本：$previous" >&2
    set_image "$previous"
    remote "cd $REMOTE_DIR && docker compose up -d api worker"
  fi
  echo "迁移已经跑过、不会自动撤回；如果需要回到部署前的数据，见 docs/ops.md 的“从备份恢复”" >&2
  exit 1
fi
echo "api 已经是 $sha"

step "6. 网页切到新版本"
if [[ $web -eq 1 ]]; then
  sync_dir --exclude assets apps/web/dist/ "$host:$REMOTE_DIR/web/"
fi
remote "docker image prune -f > /dev/null"
if curl -fsS --max-time 10 "$SITE/health" | grep -q "\"build\":\"$sha\""; then
  echo "$SITE 已经是 $sha"
else
  echo "从外网访问 $SITE/health 没看到新版本，检查 nginx 和 Cloudflare（docs/ops.md）" >&2
  exit 1
fi
