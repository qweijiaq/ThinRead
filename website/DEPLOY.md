# 官网与留言台部署

线上地址：

- 官网：<https://thinread.weijia.asia>
- 留言台：<https://feedback.weijia.asia>

两者和 Folio / Penpal / CloseRead 共用同一台服务器与同一个 Caddy 容器，不另起反向代理。

## 1. 架构

```text
thinread.weijia.asia ─┐
                      ├─ folio-caddy-1 (80/443, 自动 HTTPS)
feedback.weijia.asia ─┘
        │ folio_default 网络
        ├─ thinread-web    Caddy file-server :80
        └─ feedback-desk   Node 22 :8787
```

| 项目 | 值 |
| --- | --- |
| 服务器 | `114.215.193.207` |
| 官网目录 | `/opt/thinread/website` |
| 官网容器 | `thinread-web` |
| 留言台目录 | `/opt/feedback-desk` |
| 留言台容器 | `feedback-desk` |
| 留言台数据 | `/opt/feedback-desk/data`（SQLite + uploads） |
| Caddy 配置 | `/config/sites/thinread.caddy`、`/config/sites/feedback.caddy` |

## 2. DNS

阿里云云解析 → `weijia.asia` → 解析设置：

| 类型 | 主机记录 | 记录值 | TTL |
| --- | --- | --- | --- |
| A | `thinread` | `114.215.193.207` | 600 |
| A | `feedback` | `114.215.193.207` | 600 |

Caddy 用 HTTP-01 / TLS-ALPN-01 自动申请和续期 Let's Encrypt 证书；DNS 生效后如果证书还没下来，重启一次 Caddy 触发重试。

## 3. 更新官网

```bash
cd /path/to/reading-notes
tar -C website -czf - --exclude='.DS_Store' . \
  | ssh root@114.215.193.207 'tar -xzf - -C /opt/thinread/website'
```

静态文件由 `thinread-web` 直接读取，不需要重启容器。更新后检查：

```bash
curl -sS -o /dev/null -w '%{http_code}\n' https://thinread.weijia.asia/
```

## 4. 更新留言台

```bash
cd /path/to/feedback-desk
tar -czf - --exclude='./data' --exclude='./node_modules' --exclude='./.git' . \
  | ssh root@114.215.193.207 'tar -xzf - -C /opt/feedback-desk'
ssh root@114.215.193.207 'cd /opt/feedback-desk && docker compose up -d --build'
```

`/opt/feedback-desk/.env` 保存管理员令牌和限流配置，权限保持 `600`，不要提交到 Git。

## 5. 备份留言台

```bash
ssh root@114.215.193.207 'cd /opt/feedback-desk && tar -czf /root/feedback-data-$(date +%F).tar.gz data'
```

迁移到新机器时，把 `db.sqlite` 和 `uploads/` 放进新容器的 `./data` 即可；路线图、留言、投票和后台回复都在这个库里。

## 6. 验证

```bash
curl -sS https://feedback.weijia.asia/api/health
curl -sS https://feedback.weijia.asia/api/public/projects/thinread
curl -sS -o /dev/null -w '%{http_code}\n' https://feedback.weijia.asia/p/thinread
```

官网的留言区通过 `website/app.js` 里的 `FEEDBACK_API` 连接留言台，线上值是 `https://feedback.weijia.asia`；本地开发时改回 `http://127.0.0.1:8787`。
