#!/bin/bash
# ECDraw 2.0 一键部署脚本
# 使用方法: chmod +x deploy.sh && ./deploy.sh

set -e  # 遇到错误立即退出

echo "======================================"
echo "  ECDraw 2.0 Web 部署脚本"
echo "======================================"
echo ""

# 颜色定义
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 检查 Docker
echo -e "${YELLOW}[1/7] 检查 Docker...${NC}"
if ! command -v docker &> /dev/null; then
    echo "Docker 未安装，正在安装..."
    curl -fsSL https://get.docker.com | sh
    sudo usermod -aG docker $USER
    echo -e "${GREEN}✓ Docker 安装完成${NC}"
else
    echo -e "${GREEN}✓ Docker 已安装: $(docker --version)${NC}"
fi

# 检查 Docker Compose
echo -e "${YELLOW}[2/7] 检查 Docker Compose...${NC}"
if ! command -v docker-compose &> /dev/null; then
    echo "Docker Compose 未安装，正在安装..."
    sudo curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
    sudo chmod +x /usr/local/bin/docker-compose
    echo -e "${GREEN}✓ Docker Compose 安装完成${NC}"
else
    echo -e "${GREEN}✓ Docker Compose 已安装: $(docker-compose --version)${NC}"
fi

# 安装 Node.js 和 pnpm
echo -e "${YELLOW}[3/7] 检查 Node.js...${NC}"
if ! command -v node &> /dev/null; then
    echo "Node.js 未安装，正在安装..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt-get install -y nodejs
    echo -e "${GREEN}✓ Node.js 安装完成${NC}"
else
    echo -e "${GREEN}✓ Node.js 已安装: $(node --version)${NC}"
fi

if ! command -v pnpm &> /dev/null; then
    echo "pnpm 未安装，正在安装..."
    npm install -g pnpm
    echo -e "${GREEN}✓ pnpm 安装完成${NC}"
else
    echo -e "${GREEN}✓ pnpm 已安装: $(pnpm --version)${NC}"
fi

# 创建部署目录
echo -e "${YELLOW}[4/7] 准备部署目录...${NC}"
DEPLOY_DIR="/opt/ecdraw2.0"
sudo mkdir -p $DEPLOY_DIR
sudo chown $USER:$USER $DEPLOY_DIR
echo -e "${GREEN}✓ 部署目录: $DEPLOY_DIR${NC}"

# 配置环境变量
echo -e "${YELLOW}[5/7] 配置环境变量...${NC}"
cat > $DEPLOY_DIR/.env << EOF
# ECDraw 2.0 生产环境配置
POSTGRES_PASSWORD=EcdrawPass_$(openssl rand -hex 8)
JWT_ACCESS_SECRET=$(openssl rand -hex 16)
JWT_REFRESH_SECRET=$(openssl rand -hex 16)
SEED_ADMIN_USERNAME=admin
SEED_ADMIN_PASSWORD=Admin_$(openssl rand -hex 6)
SERVER_PORT=3001
EOF
echo -e "${GREEN}✓ 环境变量已配置${NC}"
echo ""
echo "⚠️  请保存以下管理员登录信息："
cat $DEPLOY_DIR/.env | grep SEED_ADMIN
echo ""

# 创建 docker-compose.yml
echo -e "${YELLOW}[6/7] 创建 Docker Compose 配置...${NC}"
cat > $DEPLOY_DIR/docker-compose.yml << 'EOFDOCKER'
services:
  postgres:
    image: postgres:16-alpine
    container_name: ecdraw-postgres
    environment:
      POSTGRES_USER: ecdraw
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_DB: ecdraw2
    volumes:
      - postgres_data:/var/lib/postgresql/data
    restart: unless-stopped
    networks:
      - ecdraw-network
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ecdraw"]
      interval: 10s
      timeout: 5s
      retries: 5

  api:
    image: ghcr.io/your-org/ecdraw-api:latest
    container_name: ecdraw-api
    environment:
      DATABASE_URL: postgresql://ecdraw:${POSTGRES_PASSWORD}@postgres:5432/ecdraw2
      JWT_ACCESS_SECRET: ${JWT_ACCESS_SECRET}
      JWT_REFRESH_SECRET: ${JWT_REFRESH_SECRET}
      SERVER_PORT: 3001
      SEED_ADMIN_USERNAME: ${SEED_ADMIN_USERNAME}
      SEED_ADMIN_PASSWORD: ${SEED_ADMIN_PASSWORD}
      RUST_LOG: info
    depends_on:
      postgres:
        condition: service_healthy
    restart: unless-stopped
    networks:
      - ecdraw-network
    ports:
      - "3001:3001"

  frontend:
    image: ghcr.io/your-org/ecdraw-frontend:latest
    container_name: ecdraw-frontend
    ports:
      - "80:80"
    restart: unless-stopped
    networks:
      - ecdraw-network

volumes:
  postgres_data:

networks:
  ecdraw-network:
    driver: bridge
EOFDOCKER
echo -e "${GREEN}✓ Docker Compose 配置已创建${NC}"

# 启动服务
echo -e "${YELLOW}[7/7] 启动服务...${NC}"
cd $DEPLOY_DIR
docker-compose up -d

echo ""
echo "======================================"
echo -e "${GREEN}✓ 部署完成！${NC}"
echo "======================================"
echo ""
echo "访问地址: http://$(curl -s ifconfig.me)"
echo "管理员登录: admin / (见上方密码)"
echo ""
echo "常用命令:"
echo "  查看日志: docker-compose logs -f"
echo "  重启服务: docker-compose restart"
echo "  停止服务: docker-compose down"
echo ""
