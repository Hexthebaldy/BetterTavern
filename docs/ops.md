# 运维手册：线上服务 bettertavern.com

> 文档索引：[总览](README.md) · [后端](backend.md) · [客户端](client.md) · [测试](testing.md) · [数据模型](data-model/README.md) · [接口](api/README.md)

这一页写线上服务怎么部署、怎么看状态、出了问题怎么办。自己部署全套（本机构建镜像）看 `deploy/docker-compose.yml` 开头的说明，不用看这一页。

服务器的 IP 不写进仓库：网站经过 Cloudflare 代理，别人只能看到 Cloudflare 的地址；仓库是公开的，写进来就等于把服务器的真实地址公开了。IP 在 Vultr 后台能看到。

## 1 整体结构

```
用户（网页、App）
   │  https://bettertavern.com
   ▼
Cloudflare（代理、HTTPS、挡攻击）
   │  只有 Cloudflare 能连到服务器的 80、443（防火墙）
   ▼
服务器 nginx（Cloudflare 源站证书）
   ├─ /v1、/health、/ready ──▶ api 容器（只监听本机 127.0.0.1:8000）
   └─ 其余地址 ──────────────▶ 网页的静态文件 /srv/bettertavern/web
                                 worker 容器（后台任务：世界状态、章节、工作台 agent）
                                 postgres 容器（数据都在这里，图片也存在里面）
```

- **服务器**：Vultr 新加坡，Ubuntu 24.04，1 核、1 GB 内存、32 GB 硬盘，加了 2 GB 交换空间；登录用户 `linuxuser`，只能用 SSH 密钥登录；Vultr 的整机自动备份已打开。
- **镜像**：GitHub Actions 在每次推送到 `m1` 并且检查都通过以后构建，推到 `ghcr.io/hexthebaldy/bettertavern-server`，标签是 `sha-<提交号前 12 位>`。服务器不构建，只拉。
- **网页**：在自己电脑上构建（`apps/web/dist`），部署时传到服务器。
- **发信**：Resend（域名 bettertavern.com 已验证），发件人 `BetterTavern <noreply@bettertavern.com>`。`support@bettertavern.com` 由 Cloudflare 的 Email Routing 转到运营者的邮箱；服务报错的提醒也发到这里。
- **Cloudflare**：`bettertavern.com` 和 `www` 两条记录都开代理（橙色云朵）；SSL/TLS 模式是 Full (strict)；源站证书在服务器的 `/etc/ssl/bettertavern/`。

服务器上的文件：

| 路径 | 是什么 |
| --- | --- |
| `/srv/bettertavern/compose.yml` | 跑哪几个容器（每次部署从 `deploy/compose.prod.yml` 复制过来，不要在服务器上改） |
| `/srv/bettertavern/.env` | 私密配置：数据库密码、主密钥、令牌密钥、Resend 的 key、当前镜像（`BT_IMAGE`，部署脚本改写）。只在服务器上，权限 600 |
| `/srv/bettertavern/web/` | 网页的静态文件 |
| `/srv/bettertavern/backups/` | 每次部署前的数据库备份，只留最近 3 份 |
| `/srv/bettertavern/cloudflare-ips.sh` | 更新 Cloudflare 的 IP 段（第 7 节） |
| `/etc/nginx/sites-available/bettertavern` | nginx 配置（每次部署从 `deploy/nginx.bettertavern.conf` 复制过来） |
| `/etc/ssl/bettertavern/origin.key`、`origin.pem` | 源站证书的私钥和证书（私钥只在这台服务器上） |

## 2 第一次部署

下面的命令里，`服务器` 换成 Vultr 后台里的 IP。

1. **装机**。在自己电脑的仓库根目录：

   ```bash
   scp deploy/server-setup.sh deploy/cloudflare-ips.sh linuxuser@服务器:~
   ssh linuxuser@服务器 'bash server-setup.sh'
   ```

   它会装 Docker 和 nginx、开交换空间、建目录、配防火墙，最后打印一段 CSR（证书请求）。可以重复运行。

2. **源站证书**。Cloudflare 后台 › SSL/TLS › Origin Server › Create Certificate，选 “Use my private key and CSR”，
   把上一步打印的 CSR 整段贴进去，主机名保留 `bettertavern.com` 和 `*.bettertavern.com`，有效期默认 15 年。
   把签出来的证书存到服务器上（粘贴后按回车，再按 Ctrl-D）：

   ```bash
   ssh -t linuxuser@服务器 'sudo tee /etc/ssl/bettertavern/origin.pem > /dev/null'
   ```

   然后 SSL/TLS › Overview 把模式设为 Full (strict)。

3. **镜像**。推送代码，等 GitHub Actions 跑完（`gh run watch`）。第一次构建出来的镜像默认不公开：
   GitHub › 你的头像 › Your profile › Packages › `bettertavern-server` › Package settings › Change visibility，改成 Public。
   镜像里没有密钥（代码本来就公开），公开以后服务器不用登录就能拉。

4. **私密配置**。在服务器上生成 `.env`（密钥直接写进文件，不显示在屏幕上）：

   ```bash
   ssh linuxuser@服务器
   cd /srv/bettertavern && umask 077
   {
     echo "POSTGRES_PASSWORD=$(openssl rand -hex 24)"
     docker run --rm ghcr.io/hexthebaldy/bettertavern-server:m1 bettertavern keygen
     echo 'MAIL_FROM="BetterTavern <noreply@bettertavern.com>"'
     echo "ALERT_EMAIL=support@bettertavern.com"
   } > .env
   read -rsp "Resend 的 API key：" key && echo "RESEND_API_KEY=$key" >> .env && unset key && echo
   ```

   然后把 `MASTER_KEYS` 那一行抄进你的密码管理器（`grep MASTER_KEYS /srv/bettertavern/.env`）。
   **主密钥丢了，所有用户保存的模型 Key 都解不开**；数据库备份里的 Key 也一样，备份要和主密钥一起才有用。

5. **部署**。回到自己电脑的仓库根目录：

   ```bash
   BT_DEPLOY_HOST=linuxuser@服务器 scripts/deploy.sh
   ```

   第一次会顺带装好 nginx 配置、建好数据库。最后一行显示 “https://bettertavern.com 已经是 <提交号>” 就是成功了。

6. 打开 https://bettertavern.com 注册一个账号，确认能收到验证码邮件。

## 3 日常部署

```bash
git push                                          # 推到 m1
gh run watch                                      # 等 CI 跑完（检查、测试、构建镜像，大约几分钟）
BT_DEPLOY_HOST=linuxuser@服务器 scripts/deploy.sh   # 部署当前提交
```

脚本做的事和顺序见 `scripts/deploy.sh` 开头。几个参数：

- `--no-backup`：不备份数据库（这次没有迁移、只改了网页时可以省一点时间）；
- `--skip-web`：只换服务端，不传网页；
- `--allow-dirty`：工作区有没提交的改动也照样部署（网页会按工作区构建，一般不要用）。

部署时用户会遇到什么：旧的 api 先等正在生成的回合收尾（最多 60 秒，来不及的按失败结束，用户点重试就行），
新的 api 再用几秒启动。这段时间里接口连不上，网页和 App 会提示连接失败，过一会儿再操作就好。
所以有人在玩的时候尽量别部署，或者挑人少的时候。开着的网页继续能用（旧版本的静态文件不删），刷新以后换成新版本。

## 4 回滚

- **自动**：新版本 60 秒内没有在 `/health` 报出新的提交号，脚本会把 api 和 worker 换回上一个镜像。
- **手动换回某个版本**：在仓库里切到那个提交再部署（网页也会一起换回去）：

  ```bash
  git checkout <提交号> && BT_DEPLOY_HOST=linuxuser@服务器 scripts/deploy.sh --no-backup; git checkout m1
  ```

  只想换服务端、最快的办法：在服务器上把 `.env` 里的 `BT_IMAGE` 改成上一个标签，再 `docker compose up -d api worker`。
- **迁移不会撤回**。迁移一般只加表、加列，旧版本的代码照样能用；真的不能用时，从部署前的备份恢复（第 5 节）。

## 5 备份和恢复

- 每次部署前的数据库备份在 `/srv/bettertavern/backups/`（`pre-时间-提交号.dump`，只留最近 3 份）。
- Vultr 的整机自动备份会定期给整台服务器拍快照，在 Vultr 后台恢复。暂时没有每天的数据库备份。
- 下载一份备份到自己电脑：`scp linuxuser@服务器:/srv/bettertavern/backups/<文件名> .`

从备份恢复数据库（会覆盖现在的数据，这段时间注册的账号、写的内容都会丢）：

```bash
cd /srv/bettertavern
docker compose stop api worker
docker compose exec -T postgres pg_restore -U bettertavern -d bettertavern --clean --if-exists < backups/<文件名>
docker compose up -d api worker
```

## 6 看状态

在服务器的 `/srv/bettertavern` 下：

| 想看什么 | 命令 |
| --- | --- |
| 容器都在不在 | `docker compose ps` |
| 接口的日志 | `docker compose logs -f --tail 200 api`（worker、postgres 同理） |
| 现在是哪个版本 | `curl -s localhost:8000/health` |
| 内存、交换空间 | `free -h`，各容器占多少：`docker stats --no-stream` |
| 硬盘 | `df -h /`，数据库多大：`docker compose exec postgres psql -U bettertavern -c "select pg_size_pretty(pg_database_size('bettertavern'))"` |
| 网站的访问日志 | `sudo tail -f /var/log/nginx/access.log` |

| 官方模型最近 24 小时花了多少元 | `docker compose exec postgres psql -U bettertavern -c "select -sum(amount_micro)/1e6 from credit_ledger where kind='charge' and created_at > now() - interval '24 hours'"` |

服务报错时，每 15 分钟会把这段时间的报错合成一封邮件发到 support@bettertavern.com，邮件里只有事件名和次数，具体情况在日志里按事件名搜。

## 7 出了问题时

| 情况 | 怎么办 |
| --- | --- |
| 被大量注册、刷接口 | 先暂停注册：`.env` 里加 `REGISTRATION_OPEN=false`，`docker compose up -d api`；Cloudflare 后台可以临时打开 Under Attack 模式 |
| 验证码邮件发不出去 | 看 Resend 后台的发送记录和额度。急的话临时关掉邮箱验证：`.env` 里加 `EMAIL_VERIFICATION=false`，`docker compose up -d api`（关掉期间注册的账号直接可用） |
| 服务器卡死、SSH 连不上 | 在 Vultr 后台重启服务器；容器会自己起来 |
| 网站打不开但服务器正常 | `sudo nginx -t`、`sudo systemctl status nginx`；检查证书文件和 Cloudflare 的 SSL 模式 |
| Resend 的 key 泄露 | 在 Resend 新建一个只能发信、只限 bettertavern.com 的 key，换进 `.env`，`docker compose up -d api worker`，再删掉旧的 |
| 令牌密钥 `AUTH_SECRET` 泄露 | 换一个新的（`docker compose run --rm migrate bettertavern keygen` 输出的第二行），所有人都要重新登录 |
| 主密钥 `MASTER_KEYS` 要换 | 新的写在最前面、旧的留在后面（逗号隔开），重启以后新存的 Key 用新密钥加密，旧的照样能解 |
| 报错提醒里有 `credits.daily_budget_reached` | 官方模型最近 24 小时的花费到了 `PLATFORM_DAILY_BUDGET`，已经自动暂停（用户看到“官方模型现在太忙了”，用自己 Key 的不受影响）。先看是不是有人刷（第 9 节的查询），正常增长就调高预算：`.env` 里改 `PLATFORM_DAILY_BUDGET`，`docker compose up -d api` |
| 官方模型的 Key 泄露、DeepSeek 余额异常 | 在 DeepSeek 后台删掉这把 Key、新建一把，按第 9 节换进 `.env`，`docker compose up -d api worker` |

## 8 定期要做的

- **Cloudflare 的 IP 段**：很少变。每隔几个月，或者 Cloudflare 通知变动时，在服务器上运行 `sudo bash /srv/bettertavern/cloudflare-ips.sh`（同时更新 nginx 和防火墙）。
- **系统更新**：Ubuntu 自动装安全更新。偶尔 `sudo apt upgrade` 后 `sudo reboot`，容器会自己起来。
- **硬盘**：每次部署会清掉不用的镜像。旧版本网页的静态文件不会自动删，每次几 MB，很久以后可以清一次 `web/assets` 里一个月前的文件。
- **源站证书**：有效期 15 年，不用管。

## 9 官方模型和点数

官方模型是运营方自己的 DeepSeek Key：用户注册、验证邮箱以后不用配置就能写，按用量扣点数（1 点 = 0.001 元，新用户送 1500 点）。
规则见 [数据模型：点数](data-model/credits.md)；内容规则（`CONTENT_POLICY=sfw`）在 `deploy/compose.prod.yml` 里写死了。

**配上或更换 Key**（在服务器上；Key 不显示在屏幕上，也不进命令历史）：

```bash
cd /srv/bettertavern
sed -i '/^PLATFORM_API_KEY=/d' .env
read -rsp "DeepSeek 的 API key：" key && echo "PLATFORM_API_KEY=$key" >> .env && unset key && echo
docker compose up -d api worker
```

建议在 DeepSeek 后台给官方服务单独建一把 Key，余额充多少就是最坏情况下能花掉多少。

**第一次配上以后补发**：配 Key 之前注册的账号没有官方模型和体验额度，跑一次（重复跑不会重复发，同一个邮箱只发一次）：

```bash
docker compose run --rm migrate bettertavern credits-backfill
```

**花费**：除了第 6 节的“最近 24 小时花了多少”，按用户看谁花得最多：

```bash
docker compose exec postgres psql -U bettertavern -c "select user_id, -sum(amount_micro)/1e6 as yuan, count(*) as runs from credit_ledger where kind='charge' and created_at > now() - interval '24 hours' group by user_id order by yuan desc limit 10"
```

和 DeepSeek 后台的账单对一下：账本按白天的价格算，夜间半价时实际花得比账本少。

**给某个用户加点数**（例如补偿；`<用户 ID>` 换成实际的，`1000` 是点数）。余额和账本要在同一个事务里改：

```bash
docker compose exec -T postgres psql -U bettertavern -v ON_ERROR_STOP=1 <<'SQL'
begin;
with u as (update users set credit_micro = credit_micro + 1000 * 1000 where id = '<用户 ID>' returning id, credit_micro)
insert into credit_ledger (user_id, kind, amount_micro, balance_micro, note)
select id, 'adjust', 1000 * 1000, credit_micro, 'support' from u;
commit;
SQL
```

**几个开关**（都在 `.env` 里，改完 `docker compose up -d api worker`）：

| 配置 | 默认 | 说明 |
| --- | --- | --- |
| `PLATFORM_API_KEY` | 空 | 不配就没有官方模型 |
| `PLATFORM_DAILY_BUDGET` | 50 | 全站最近 24 小时最多花多少元，到了就暂停官方模型并发报错提醒 |
| `TRIAL_CREDITS` | 1500 | 新用户送多少点 |
| `PLATFORM_MODEL`、`PLATFORM_PRICE_*` | `deepseek-flash`，2 / 0.04 / 8 | 换模型或 DeepSeek 调价时改（单价是元 / 百万 token）；换了模型，api 启动时会把所有用户的官方模型改成新的 |
