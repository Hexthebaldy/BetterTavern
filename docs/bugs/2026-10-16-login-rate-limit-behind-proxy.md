# 照文档用 Docker 部署后，注册和登录的限流变成全站共用

> [问题记录](README.md) · 2026-10-16 · 严重程度：高 · 已修复

## 现象

为了防止有人暴力猜密码，服务器限制每个 IP 每分钟最多登录 5 次、注册 5 次。
但按 `deploy/docker-compose.yml` 加反向代理部署以后，服务器眼里所有请求都来自同一个 IP，于是全站用户共用这 5 次：

- 有人每分钟故意输错 5 次密码，这一分钟里所有人都登不上，只会看到“请求太频繁”；
- 用户一多，正常登录也会碰到“请求太频繁”。登录成功也算次数。

## 原因

请求的路线是：用户 → 宿主机上的 nginx → Docker 网关 → 容器里的 api。

- api 看到的“对方地址”是 Docker 网关（类似 `172.18.0.1`），不是用户。
- 用户的真实 IP 由 nginx 写在请求头 `X-Forwarded-For` 里。但这个头谁都能写，服务器只应该相信来自反向代理的那一份。
- 相信谁由 uvicorn 的 `forwarded_allow_ips` 决定，默认只信 `127.0.0.1` 和 `::1`。Docker 网关不在其中，所以服务器忽略了 nginx 送来的真实 IP，
  把每个请求都算成网关的地址，限流（`api/deps.py` 的 `client_ip`）也就按这一个地址计数。
- [api/README.md](../api/README.md) 早就写了“部署在反向代理后面要设置 `FORWARDED_ALLOW_IPS`”，但 `docker-compose.yml` 没设，
  代码里也没有对应的配置项，只能靠 uvicorn 自己读环境变量。

## 影响范围

- **受影响**：用 `deploy/docker-compose.yml` 部署、前面放了反向代理的服务，也就是文档推荐的生产部署方式。
- **不受影响**：
  - 本机开发：手机直接连 api，没有代理；
  - 不用 Docker、nginx 和 api 在同一台机器上直接跑：nginx 从 `127.0.0.1` 连进来，本来就受信任。
- 不会泄露数据，但能让所有用户登录不了，属于拒绝服务。

## 修复

1. 新增配置项 `FORWARDED_ALLOW_IPS`（`settings.py`），默认值不变，还是只信本机。可以写网段，逗号隔开。
2. 启动服务器时把它明确交给 uvicorn（`entrypoints/server.py` 的 `proxy_options`，`bettertavern serve` 和 `--reload` 两种启动方式都用），不再依赖 uvicorn 偷偷读环境变量。
3. `deploy/docker-compose.yml` 给 api 设了 `127.0.0.1,::1,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16`，覆盖 Docker 默认会用到的内网段。
4. `.env.example`、`deploy/nginx.example.conf`、[api/README.md](../api/README.md) 里写明了这个配置的作用。

为什么信任整个内网段是安全的：

- compose 里 api 的端口只发布在宿主机的 `127.0.0.1` 上，公网来的连接到不了容器，能连进来的只有宿主机上的程序（反向代理）和同一个 Docker 网络里我们自己的容器。
- 即使有人把端口改成对公网开放，公网用户直连时的来源是他自己的公网 IP，不在受信任的网段里，他写的 `X-Forwarded-For` 照样不被采信。
- 用户自己在请求里塞一个假的 `X-Forwarded-For`，nginx 会把真实 IP 追加在最后。服务器从后往前跳过受信任的地址，取的是 nginx 追加的那个，伪造不了。

## 验证

`apps/server/tests/unit/api/test_proxy_client_ip.py` 用和 `bettertavern serve` 一样的 uvicorn 配置包装一个带登录限流的应用，模拟请求经 Docker 网关进来：

- 用 compose 里的配置：两个用户各有各的 5 次，一个用完不影响另一个；
- 用旧的默认配置：所有请求都被算成网关的地址，第二个用户也被挡住。这就是修复前的样子；
- 用户伪造 `X-Forwarded-For`：服务器仍按真实 IP 计数，换假 IP 也拿不到新的次数；
- 不经代理直接连进来的人：自己写的 `X-Forwarded-For` 不被采信。

没能验证的部分：本机没有 Docker，没有真的起容器测。“经 Docker 网关进来的请求，来源是网关地址”是 Docker 的常规行为，测试里是模拟的。

## 遗留

- 限流只按 IP 计数。同一个公司、学校或手机运营商的出口 IP 后面可能有很多人，他们共用 5 次；登录成功也算次数。
  以后可以改成“按 IP 加按邮箱”，并且只计失败的登录。
- 反向代理不在 Docker 的内网段里时（例如在另一台机器上），要自己把它的地址加进 `FORWARDED_ALLOW_IPS`。
