# ECDraw 2.0 部署指南

## 架构概览

```
┌─── 主机电脑 (服务器) ───┐       ┌─── 客户端电脑 ───┐
│  PostgreSQL :5432        │       │  ECDraw 桌面应用   │
│  ecdraw-server :3001     │◄─HTTP─│  VITE_API_MODE=http│
│  (axum REST API)         │       │  无需安装数据库     │
└──────────────────────────┘       └──────────────────┘
```

- **主机**：运行数据库 + HTTP API 服务，存放所有数据
- **客户端**：仅运行 Tauri 桌面壳，通过 HTTP 与主机通信
- 客户端不持有数据库凭据、JWT 密钥等敏感配置

---

## 一、主机部署

### 1. 环境要求

- Windows 10/11（普通办公电脑即可）
- PostgreSQL 15+（[postgresql.org](https://www.postgresql.org/download/windows/)）
- 主机需长期开机，建议固定 IP 地址

### 2. 安装 PostgreSQL

安装时记住设置的 `postgres` 用户密码。安装完成后确保服务已启动：

```powershell
Get-Service postgresql*
```

### 3. 编译 ecdraw-server

```bash
cd ecdraw2.0
cargo build -p ecdraw-server --release
```

编译产物位于 `target/release/ecdraw-server.exe`。

### 4. 配置 .env

在项目根目录（或 exe 同目录）创建 `.env`：

```env
# 数据库连接（主机本机 localhost）
DATABASE_URL=postgresql://postgres:你的密码@localhost:5432/ecdraw2

# JWT 密钥（请务必修改为随机字符串！至少 32 位）
JWT_ACCESS_SECRET=请生成一个随机字符串替换这里
JWT_REFRESH_SECRET=请生成另一个随机字符串替换这里

# 初始管理员账号
SEED_ADMIN_USERNAME=admin
SEED_ADMIN_PASSWORD=请设置一个安全密码

# HTTP 服务端口
SERVER_PORT=3001
```

### 5. 防火墙配置

开放 `3001` 端口（仅对局域网）：

```powershell
New-NetFirewallRule -DisplayName "ECDraw Server" -Direction Inbound -LocalPort 3001 -Protocol TCP -Action Allow -Profile Private
```

**不需要**开放 5432 端口（数据库仅主机本机访问）。

### 6. 启动服务

```bash
./ecdraw-server.exe
```

首次启动会自动：
- 创建 `ecdraw2` 数据库（如不存在）
- 执行数据库迁移（建表）
- 创建初始管理员账号

输出示例：
```
ECDraw Server 启动于 http://0.0.0.0:3001
管理员用户 'admin' 已自动创建
```

### 7. 设置开机自启（可选）

将 `ecdraw-server.exe` 快捷方式放入 Windows 启动文件夹：
`Win+R` → `shell:startup`

---

## 二、客户端部署

### 1. 配置环境变量

客户端项目 `.env` 中设置：

```env
# 使用 HTTP 模式
VITE_API_MODE=http

# 主机地址（替换为实际 IP）
VITE_API_BASE_URL=http://192.168.1.100:3001
```

客户端 `.env` 中**不需要** `DATABASE_URL`、`JWT_ACCESS_SECRET` 等敏感信息。

### 2. 编译客户端

```bash
pnpm install
pnpm tauri build
```

安装包位于 `src-tauri/target/release/bundle/`。

---

## 三、开发联调

### 单机开发模式（默认）

```bash
pnpm tauri dev
# 或不设置 VITE_API_MODE（默认 tauri 模式）
```

### 服务器联调模式

```bash
# 终端 1：启动 API 服务器
cargo run -p ecdraw-server

# 终端 2：前端开发（指向本地服务器）
VITE_API_MODE=http VITE_API_BASE_URL=http://localhost:3001 pnpm dev
```

---

## 四、数据库备份

在主机上定期备份：

```bash
# 备份
"C:\Program Files\PostgreSQL\18\bin\pg_dump.exe" -U postgres -Fc ecdraw2 > ecdraw2_$(date +%Y%m%d).dump

# 恢复
"C:\Program Files\PostgreSQL\18\bin\pg_restore.exe" -U postgres -d ecdraw2 ecdraw2_20260507.dump
```

建议用 Windows 任务计划程序设置每日备份。

---

## 五、常见问题

### 数据库连接失败

检查 PostgreSQL 服务是否运行：
```powershell
Get-Service postgresql*
```

### 客户端连接不上

1. 确认主机 IP 是否正确
2. 确认主机防火墙已放行 3001 端口
3. 确认双方在同一局域网

### 登录失败

查看服务器控制台日志，确认管理员账号是否已自动创建。
