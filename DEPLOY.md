# 部署指南 / Deployment

## 方式一：本机自用

需要 Node.js ≥ 18（[下载](https://nodejs.org/)，无需 npm install）。

- **Windows**：右键 `install.ps1` → 使用 PowerShell 运行；或手动 `node server.js`
- **macOS / Linux / Android Termux**：`bash install.sh`；或手动 `node server.js`

启动后浏览器访问 `http://localhost:<端口>/`。

## 方式二：电脑当家里的服务器（手机同 WiFi 访问）

1. `.env` 里把 `HOST=localhost` 改成 `HOST=0.0.0.0`
2. 防火墙放行端口（Windows 用管理员运行 install.ps1 会自动放行）
3. 手机连同一 WiFi，浏览器访问 `http://<电脑内网IP>:<端口>/`
4. 橘瓣等 MCP 客户端连接 `http://<电脑内网IP>:<端口>/mcp`，请求头 `Authorization: Bearer <token>`

注意：电脑休眠/关机服务即停。

## 方式三：随时随地访问（Tailscale，推荐）

服务器与手机都安装 Tailscale 并登录同一账号，手机访问 `http://<服务器Tailscale IP>:<端口>/`。免费、加密、穿透 NAT。

## 方式四：VPS / 云服务器（7×24）

上传本目录到服务器，`bash install.sh` 之后参考下方 systemd 示例注册服务。

```ini
[Unit]
Description=slot machine MCP server
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/<项目目录>
EnvironmentFile=/opt/<项目目录>/.env
ExecStart=/usr/bin/node /opt/<项目目录>/server.js
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

## 安全提示

- token 生成：`python3 -c 'import secrets; print(secrets.token_urlsafe(32))'`
- `HOST=0.0.0.0` = 同网络内所有人可访问，token 是唯一的门锁，别用弱 token
- 18+ 内容，不要把地址和 token 分享出去
