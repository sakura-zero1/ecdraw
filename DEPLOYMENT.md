# ECDraw 2.0 Web 部署指南

## 前置要求

服务器需要安装：
- Docker (>= 20.10)
- Docker Compose (>= 2.0)

## 部署步骤

### 1. 准备服务器

```bash
# SSH 连接到服务器
ssh user@your-server-ip

# 安装 Docker（如未安装）
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER

# 安装 Docker Compose（如未安装）
sudo curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
sudo chmod +x /usr/local/bin/docker-compose
```

### 2. 上传项目文件

在本地机器上：

```bash
# 方法1: 使用 rsync
rsync -av --exclude='node_modules' --exclude='target' --exclude='.git' \
  /path/to/ecdraw2.0 user@your-server-ip:/opt/ecdraw2.0

# 方法2: 使用 git（推荐）
ssh user@your-server-ip
git clone https://your-repo-url /opt/ecdraw2.0
cd /opt/ecdraw2.0
```

### 3. 配置环境变量

```bash
cd /opt/ecdraw2.0

# 复制环境变量模板
cp .env.production .env

# 编辑配置文件（必须修改密码和密钥！）
nano .env
```

**重要：请修改以下配置**

| 配置项 | 说明 | 建议值 |
|--------|------|--------|
| `POSTGRES_PASSWORD` | 数据库密码 | 随机16位以上 |
| `JWT_ACCESS_SECRET` | JWT访问令牌密钥 | 随机32位以上 |
| `JWT_REFRESH_SECRET` | JWT刷新令牌密钥 | 随机32位以上 |
| `SEED_ADMIN_PASSWORD` | 管理员密码 | 强密码 |

生成随机密钥：
```bash
# 生成随机密钥
openssl rand -base64 32
```

### 4. 构建前端

```bash
# 在服务器上构建前端
cd /opt/ecdraw2.0

# 设置环境变量
export VITE_API_MODE=http

# 安装依赖并构建
npm install -g pnpm
pnpm install
pnpm build
```

### 5. 启动服务

```bash
# 启动所有容器
docker-compose up -d

# 查看日志
docker-compose logs -f

# 检查服务状态
docker-compose ps
```

### 6. 配置域名（可选）

如果有域名，配置 DNS 指向服务器 IP，然后修改 `nginx.conf`：

```nginx
server_name your-domain.com;
```

### 7. 配置 HTTPS（可选）

使用 Let's Encrypt 免费证书：

```bash
# 安装 certbot
sudo apt-get install certbot python3-certbot-nginx

# 获取证书
sudo certbot --nginx -d your-domain.com

# 自动续期
sudo systemctl enable certbot.timer
```

## 验证部署

1. **访问前端**：`http://your-server-ip` 或 `http://your-domain.com`
2. **登录测试**：使用管理员账户登录（默认 `admin` / 你设置的密码）
3. **API 测试**：`http://your-server-ip/api/health`

## 常用命令

```bash
# 查看日志
docker-compose logs -f api
docker-compose logs -f frontend

# 重启服务
docker-compose restart api

# 停止服务
docker-compose down

# 更新后重新部署
git pull
pnpm build
docker-compose up -d --build

# 备份数据库
docker-compose exec postgres pg_dump -U ecdraw ecdraw2 > backup.sql

# 恢复数据库
docker-compose exec -T postgres psql -U ecdraw ecdraw2 < backup.sql
```

## 故障排查

### 前端无法访问

```bash
# 检查 Nginx 日志
docker-compose logs frontend

# 检查前端文件是否存在
ls -la dist/
```

### API 无法访问

```bash
# 检查 API 日志
docker-compose logs api

# 检查数据库连接
docker-compose exec api wget -O- http://postgres:5432
```

### 数据库问题

```bash
# 进入数据库容器
docker-compose exec postgres psql -U ecdraw ecdraw2

# 查看表
\dt

# 重置数据库（危险操作！）
docker-compose down -v
docker-compose up -d
```

## 安全建议

1. **修改所有默认密码**
2. **配置防火墙**：只开放 80/443 端口
3. **启用 HTTPS**：使用 Let's Encrypt 免费证书
4. **定期备份**：设置定时备份数据库
5. **限制访问**：配置 Nginx IP 白名单（如需要）

## 性能优化

1. **启用 Nginx 缓存**：已在 nginx.conf 中配置
2. **调整 PostgreSQL 配置**：编辑 `postgresql.conf`
3. **增加 Worker 数量**：修改 Rust 代码中的线程池配置

## 监控

```bash
# 查看容器资源使用
docker stats

# 查看数据库连接
docker-compose exec postgres psql -U ecdraw -c "SELECT count(*) FROM pg_stat_activity;"
```
