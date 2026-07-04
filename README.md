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

## 技术栈

- Python 3.14+
- FastAPI
- SQLModel
- SQLite
- Uvicorn
- 原生 HTML / CSS / JavaScript
- Cytoscape.js
- Vditor Markdown Editor

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
├── model.py               # SQLModel 数据模型和枚举
├── service.py             # 任务、链接、审计日志服务层
├── pyproject.toml         # 项目元信息和依赖
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
