# TaskMana MVP

TaskMana 是一个基于任务图的轻量任务管理 MVP。任务是节点，任务之间的关系是边；你可以用看板管理任务状态，也可以用网络图查看任务之间的包含、阻塞和派生关系。

项目当前由 FastAPI 提供 REST API，SQLModel + SQLite 负责数据持久化，前端是一个静态 SPA。

## 功能特性

- 任务 CRUD：创建、查看、编辑、删除任务
- 任务看板：按 `todo`、`in_progress`、`blocked`、`done`、`paused`、`cancelled` 分组展示
- 拖拽改状态：在看板列之间拖动任务卡片即可更新状态
- 任务详情：维护标题、描述、类型、标签、来源、人员、地点、截止时间和预计耗时
- 计划 / 日志 / 复盘：每个任务支持 Markdown 内容编辑
- 任务关系：支持 `contains`、`blocks`、`derives` 三种链接类型
- 网络图视图：使用 Cytoscape 展示任务图
- 审计日志：记录任务和链接的创建、更新、删除快照
- 图片上传：支持在 Markdown 内容中上传 PNG、JPEG、GIF、WebP、SVG 图片
- 明暗主题：前端支持亮色 / 暗色模式切换
- MCP Server：支持 AI 助手通过 MCP 协议操作任务和链接（13 个工具）

## 技术栈

- Python 3.14+
- FastAPI
- SQLModel
- SQLite
- Uvicorn
- 原生 HTML / CSS / JavaScript
- Cytoscape.js
- Vditor Markdown Editor

## 许可证

本项目基于 GNU General Public License v3.0 or later 开源，详见 [LICENSE](LICENSE) 文件。

Copyright (C) 2026 TaskMana Authors
- Docker

## 快速开始

### 1. 安装依赖

本项目使用 `uv` 管理 Python 环境和依赖：

```bash
uv sync
```

如果本机还没有安装 `uv`，可以参考官方文档安装后再执行上面的命令。

### 2. 启动服务

```bash
uv run python main.py
```

默认启动地址：

```text
http://0.0.0.0:8000
```

本机访问通常使用：

```text
http://localhost:8000
```

API 文档地址：

```text
http://localhost:8000/docs
```

### 3. 常用启动参数

```bash
# 指定端口
uv run python main.py --port 9000

# 指定监听地址
uv run python main.py --host 127.0.0.1

# 指定 SQLite 数据库文件
uv run python main.py --db ./mydb.db

# 开发时启用自动重载
uv run python main.py --reload
```

默认数据库文件为项目根目录下的 `taskmana.db`，首次启动时会自动创建表结构。

## Docker 部署

项目已封装 Docker，支持一键构建和运行。

### 快速启动（docker compose）

```bash
# 1. 配置环境变量（如尚未创建）
cp .env.example .env
# 编辑 .env，将 TASKMANA_SECRET_KEY 改成随机字符串
# 生成随机密钥: python -c "import secrets; print(secrets.token_urlsafe(32))"

# 2. 构建并启动
docker compose up -d

# 3. 创建初始用户
docker compose exec taskmana python cli.py create-user
```

服务启动后访问 `http://localhost:8000`。

### 环境变量

| 变量 | 必填 | 默认值 | 说明 |
|---|---|---|---|
| `TASKMANA_SECRET_KEY` | ✅ | — | JWT 签名密钥 |
| `TASKMANA_TOKEN_EXPIRE_MINUTES` | ❌ | `1440` | Token 过期时间（分钟） |
| `TASKMANA_PORT` | ❌ | `8000` | 宿主机映射端口 |

### 数据持久化

| 卷 | 容器内路径 | 说明 |
|---|---|---|
| `taskmana_data` | `/app/data` | SQLite 数据库文件 |
| `taskmana_uploads` | `/app/uploads` | 上传的图片文件 |

### 常用命令

```bash
# 查看日志
docker compose logs -f

# 停止服务
docker compose down

# 停止并删除数据卷（慎用！会清空数据库）
docker compose down -v

# 重新构建镜像
docker compose build --no-cache

# 进入容器 shell
docker compose exec taskmana bash
```

### 开发模式（热重载）

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up
```

开发模式下源码通过 bind-mount 挂载，修改 Python 代码后服务自动重启，前端静态文件修改即时生效。

### 纯 Docker 命令（不使用 compose）

```bash
# 构建镜像
docker build -t taskmana-mvp .

# 运行容器
docker run -d \
  --name taskmana-mvp \
  -p 8000:8000 \
  -e TASKMANA_SECRET_KEY=your-secret-key \
  -v taskmana_data:/app/data \
  -v taskmana_uploads:/app/uploads \
  taskmana-mvp

# 创建用户
docker exec -it taskmana-mvp python cli.py create-user
```

### Docker Secret 支持

除环境变量外，也可以通过 Docker secret 传入密钥：

```bash
echo "your-secret-key" | docker secret create taskmana_secret_key -
```

容器启动时会优先读取 `/run/secrets/taskmana_secret_key`。

## API 概览

### 任务

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/tasks` | 获取任务列表 |
| `GET` | `/tasks/{task_id}` | 获取单个任务 |
| `POST` | `/tasks` | 创建任务 |
| `PATCH` | `/tasks/{task_id}` | 更新任务 |
| `DELETE` | `/tasks/{task_id}` | 删除任务及相关链接 |

### 链接

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/links` | 获取链接列表 |
| `GET` | `/links/{link_id}` | 获取单个链接 |
| `POST` | `/links` | 创建任务链接 |
| `PATCH` | `/links/{link_id}` | 更新链接备注 |
| `DELETE` | `/links/{link_id}` | 删除链接 |

### 审计日志

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/audit` | 获取审计日志，支持按实体类型、实体 ID、动作过滤 |
| `GET` | `/audit/{audit_id}` | 获取单条审计日志 |

### 图片上传

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `POST` | `/api/images` | 上传 Markdown 图片，最大 10 MB |

## 数据模型

### Task

主要字段：

- `id`：任务 ID
- `title`：标题
- `description`：描述
- `task_type`：任务类型，取值为 `execution`、`communication`、`composite`
- `status`：任务状态，取值为 `todo`、`in_progress`、`blocked`、`done`、`cancelled`、`paused`
- `tags`：标签列表
- `source`：任务来源
- `deadline`：截止时间
- `duration`：预计耗时，单位为分钟
- `people`：相关人员列表
- `location`：地点
- `plan`：计划内容
- `log`：日志内容
- `review`：复盘内容
- `created_at` / `updated_at`：创建和更新时间

### Link

主要字段：

- `id`：链接 ID
- `from_task_id`：起点任务 ID
- `to_task_id`：终点任务 ID
- `link_type`：链接类型，取值为 `contains`、`blocks`、`derives`
- `note`：备注
- `created_at`：创建时间

创建链接时会校验：

- 起点和终点任务必须存在
- 不允许任务链接到自身
- 不允许创建重复的同类型链接

## 项目结构

```text
.
├── api.py                 # FastAPI 应用、路由和请求/响应模型
├── audit.py               # 审计日志序列化与事件监听
├── database.py            # SQLite 引擎、会话和初始化逻辑
├── main.py                # 服务启动入口
├── mcp_serve.py           # MCP Server 定义（工具 + 认证中间件）
├── model.py               # SQLModel 数据模型和枚举
├── service.py             # 任务、链接、审计日志服务层
├── auth.py                # JWT 认证与用户管理
├── cli.py                 # 命令行工具（创建用户等）
├── pyproject.toml         # 项目元信息和依赖
├── Dockerfile             # 生产环境 Docker 镜像
├── Dockerfile.dev         # 开发环境 Docker 镜像（含热重载）
├── docker-compose.yml     # Docker Compose 编排（生产）
├── docker-compose.dev.yml # Docker Compose 覆盖（开发）
├── .dockerignore          # Docker 构建忽略文件
└── static/
    ├── index.html         # 前端入口
    ├── css/style.css      # 前端样式
    ├── js/api.js          # 前端 API 客户端
    ├── js/app.js          # SPA 交互逻辑
    ├── js/cytoscape.min.js
    └── uploads/           # 图片上传目录
```

## 开发说明

- 后端入口是 `main.py`，实际 FastAPI app 定义在 `api.py`
- 数据库初始化在服务启动前自动执行
- 静态前端由 FastAPI 挂载在 `/static`，根路径 `/` 返回 `static/index.html`
- API 返回值通过 `audit.py` 中的序列化函数统一处理
- 删除任务时会同时删除与该任务相关的链接
- SQLite 外键约束会在连接时自动启用

## 示例请求

创建任务：

```bash
curl -X POST http://localhost:8000/tasks \
	-H 'Content-Type: application/json' \
	-d '{
		"title": "整理产品路线图",
		"task_type": "execution",
		"status": "todo",
		"tags": ["product", "planning"],
		"duration": 60
	}'
```

创建阻塞关系：

```bash
curl -X POST http://localhost:8000/links \
	-H 'Content-Type: application/json' \
	-d '{
		"from_task_id": 1,
		"to_task_id": 2,
		"link_type": "blocks",
		"note": "任务 1 完成后才能开始任务 2"
	}'
```

查询某个任务的审计日志：

```bash
curl 'http://localhost:8000/audit?entity_type=task&entity_id=1'
```

## MCP Server

TaskMana 内置了 MCP (Model Context Protocol) 服务，允许 AI 助手（如 VS Code Copilot、Claude Desktop 等）通过标准 MCP 协议直接操作任务和链接。

### 端点

```
http://localhost:8000/mcp
```

协议：StreamableHTTP (MCP 2024-11-05+)

### 认证

MCP 服务与 REST API 共用 JWT Bearer Token 认证。使用前需要先通过 `/auth/login` 获取 token：

```bash
TOKEN=$(curl -s -X POST http://localhost:8000/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"your_username","password":"your_password"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])")

echo $TOKEN
```

### MCP 工具清单

| 工具名 | 说明 |
|--------|------|
| `mcp_list_tasks` | 列出所有任务，返回 id、标题、状态、类型、标签、截止时间 |
| `mcp_get_task` | 获取单个任务完整详情 |
| `mcp_create_task` | 创建新任务（`title` 必填，其余可选） |
| `mcp_update_task` | 部分更新任务字段 |
| `mcp_delete_task` | 删除任务及所有关联链接 |
| `mcp_list_links` | 列出所有链接 |
| `mcp_get_link` | 获取单个链接详情 |
| `mcp_create_link` | 创建任务间链接（`contains` / `blocks` / `derives`） |
| `mcp_delete_link` | 删除链接 |
| `mcp_get_task_graph` | 返回完整图数据（所有任务 + 所有链接），用于图分析 |
| `mcp_get_related_tasks` | 获取与指定任务直接关联的所有任务及其关系 |
| `mcp_search_tasks` | 按标题关键词、标签或描述搜索任务 |
| `mcp_list_audit_logs` | 查询审计日志，支持按实体类型、ID、动作过滤 |

### 配置 MCP 客户端

#### VS Code / Copilot

在项目根目录或用户目录创建 `.vscode/mcp.json`：

```json
{
  "servers": {
    "taskmana": {
      "type": "http",
      "url": "http://localhost:8000/mcp",
      "headers": {
        "Authorization": "Bearer <YOUR_JWT_TOKEN>"
      }
    }
  }
}
```

#### Claude Desktop

在 Claude Desktop 配置文件中添加：

```json
{
  "mcpServers": {
    "taskmana": {
      "type": "http",
      "url": "http://localhost:8000/mcp",
      "headers": {
        "Authorization": "Bearer <YOUR_JWT_TOKEN>"
      }
    }
  }
}
```

### 使用示例

配置好 MCP 客户端后，可以直接用自然语言与 AI 助手交互：

- "列出所有未完成的任务"
- "创建一个名为「发布 v2.0」的任务，类型为 execution"
- "把任务 3 的状态改为 done"
- "任务 1 阻塞了哪些任务？"
- "搜索标题包含「产品」的任务"
- "显示最近 10 条审计日志"

### 安全注意事项

- JWT Token 有过期时间（默认 24 小时，可通过环境变量 `TASKMANA_TOKEN_EXPIRE_MINUTES` 调整）
- MCP 服务与 Web 前端共享同一数据库，AI 操作会实时反映在看板中
- 所有 MCP 操作都会记录审计日志，可在 Web 界面的审计日志中查看
- 建议为 MCP 客户端使用独立的用户账号，便于区分人工操作和 AI 操作
