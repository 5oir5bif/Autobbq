# AutoBBQ

AutoBBQ 是一个本地跑的视频字幕工具。现在主要做这几件事：上传英文视频，生成英文字幕，翻译成中文字幕，在前端调整字幕样式，然后把中文字幕烧录回视频。

项目目前还在重构中。现在能跑的是 TypeScript 后端，数据已经从 JSON 文件换成 SQLite。Rust 后端放在 `backend-rs`，目前只是迁移骨架，还没有完全替代现有后端。

## 现在能做什么

- 上传 `mp4`、`mov`、`webm` 视频
- 限制视频时长和上传大小
- 生成英文字幕
- 翻译成中文字幕
- 生成 `VTT` / `SRT` 字幕文件
- 在网页里预览视频和字幕位置
- 调整字幕字体、位置、颜色、描边、阴影、对齐方式
- 渲染带中文字幕的成品视频
- 用 Mock provider 本地调试
- 接 OpenAI-compatible 的 ASR / 翻译接口

## 技术栈

当前主线：

- Frontend: Next.js + React + TypeScript
- Backend: Express + TypeScript
- Database: SQLite
- Queue: BullMQ + Redis
- Media: FFmpeg / FFprobe
- Subtitle: VTT / SRT / ASS

迁移方向：

- Rust backend: Axum + SQLx + SQLite
- 位置：`backend-rs`
- 状态：骨架已建好，还没完全迁完

## 目录

```txt
.
├── backend        # 当前实际运行的后端
├── backend-rs     # Rust 后端迁移骨架
├── frontend       # Next.js 前端
├── docker-compose.yml
├── package.json
└── README.md
```

几个比较重要的目录：

- `backend/src/api`: Express API
- `backend/src/jobs`: BullMQ 队列和 worker
- `backend/src/providers`: ASR / 翻译 provider
- `backend/src/services/store.ts`: SQLite 数据层
- `backend/storage`: 上传文件、字幕、输出视频、SQLite 数据库
- `frontend/components`: 上传页和视频编辑器
- `backend-rs/migrations`: Rust 侧 SQLite schema

## 环境要求

- Node.js `>=22.5.0`
- npm `>=10`
- Redis
- FFmpeg / FFprobe
- Docker 可选
- Rust 可选，只有跑 `backend-rs` 时需要

Node 22+ 是必须的，因为后端现在用了 Node 内置的 `node:sqlite`。

## 本地启动

安装依赖：

```bash
npm install
```

复制环境变量：

```bash
cp .env.example .env
```

启动 Redis。如果本机没有 Redis，可以临时用 Docker 跑一个：

```bash
docker run --rm -p 6379:6379 redis:7-alpine
```

安装 FFmpeg。

macOS:

```bash
brew install ffmpeg
```

Ubuntu / Debian:

```bash
sudo apt-get update
sudo apt-get install -y ffmpeg fonts-noto-cjk
```

启动前后端：

```bash
npm run dev
```

默认地址：

- Frontend: http://localhost:3000
- Backend: http://localhost:4000

## Docker 启动

```bash
docker compose up --build
```

停止：

```bash
docker compose down
```

Docker 会启动前端、后端和 Redis。

## 环境变量

常用的几个：

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PORT` | `4000` | 后端端口 |
| `API_BASE_URL` | `http://localhost:4000` | 后端对外地址 |
| `FRONTEND_ORIGIN` | `http://localhost:3000` | CORS 前端来源 |
| `REDIS_URL` | `redis://localhost:6379` | Redis 地址 |
| `STORAGE_DIR` | `storage` | 后端存储目录 |
| `DATABASE_URL` | `sqlite:storage/data/autobbq.sqlite` | SQLite 地址 |
| `ASR_PROVIDER` | `mock` | `mock` 或 `openai` |
| `TRANSLATION_PROVIDER` | `mock` | `mock` 或 `openai` |
| `NEXT_PUBLIC_API_BASE_URL` | `http://localhost:4000` | 前端请求后端的地址 |

真实模型相关：

| 变量 | 说明 |
| --- | --- |
| `OPENAI_API_KEY` | API key |
| `OPENAI_BASE_URL` | OpenAI-compatible base URL |
| `OPENAI_ASR_MODEL` | ASR 模型名 |
| `OPENAI_TRANSLATION_MODEL` | 翻译模型名 |

本地开发默认可以直接用 Mock：

```env
ASR_PROVIDER=mock
TRANSLATION_PROVIDER=mock
```

## API

### `GET /health`

查看后端是否正常，以及当前 provider / 上传限制等配置。

### `GET /api/runtime-config`

读取当前模型配置。

### `POST /api/runtime-config`

更新运行时模型配置。

```json
{
  "openAiApiKey": "optional",
  "openAiBaseUrl": "https://api.openai.com/v1",
  "openAiAsrModel": "gpt-4o-mini-transcribe",
  "openAiTranslationModel": "gpt-4o-mini"
}
```

### `POST /api/videos/upload`

上传视频。字段名是 `file`。

返回：

```json
{
  "videoId": "...",
  "originalUrl": "http://localhost:4000/files/uploads/...mp4",
  "durationSec": 123.4
}
```

### `GET /api/videos/:id`

读取视频信息，包括字幕 URL 和输出视频 URL。

### `POST /api/videos/:id/process`

开始 ASR 和翻译任务。

```json
{
  "jobId": "..."
}
```

### `GET /api/jobs/:jobId`

查询任务状态。

```json
{
  "jobId": "...",
  "status": "queued",
  "progress": 30
}
```

`status` 可能是：`queued`、`running`、`succeeded`、`failed`。

### `POST /api/videos/:id/render`

按前端设置的字幕样式渲染最终视频。

```json
{
  "fontSize": 35,
  "position": { "x": 0.5, "y": 0.85 },
  "maxWidthRatio": 0.9,
  "stroke": { "enabled": true, "width": 2 },
  "shadow": { "enabled": true, "opacity": 0.3 },
  "fontFamily": "Noto Sans SC",
  "fontColor": "#ffffff",
  "textAlign": "center"
}
```

### `GET /api/videos/:id/output`

渲染完成后读取最终视频地址。

## 存储

默认存储目录：

```txt
backend/storage
├── data        # SQLite 数据库
├── output      # 渲染后视频
├── subtitles   # 字幕文件
├── temp        # 临时文件
└── uploads     # 上传视频
```

默认数据库：

```txt
backend/storage/data/autobbq.sqlite
```

如果旧版本里有 `backend/storage/data/db.json`，后端启动时会迁移到 SQLite，然后把旧文件改名成 `db.json.migrated`。

## Rust 后端

`backend-rs` 是迁移用的 Rust 后端骨架。

现在已经有：

- `GET /health`
- `GET /api/runtime-config`
- `POST /api/runtime-config`
- `GET /api/videos/:id`
- `GET /api/videos/:id/output`
- SQLite migration
- `/files` 静态文件服务

还没迁的：

- 上传视频
- FFprobe 读取视频信息
- ASR provider
- 翻译 provider
- worker / queue
- FFmpeg 烧录字幕

有 Rust 工具链后可以试：

```bash
cd backend-rs
cargo test
cargo run
```

Rust 服务默认端口逻辑：先读 `RUST_BACKEND_PORT`，再读 `PORT`，最后 fallback 到 `4001`。

## 常用命令

```bash
npm run dev               # 启动前端和后端
npm run build             # 构建前端和后端
npm run test              # 跑后端测试
npm run build -w backend  # 只构建后端
npm run build -w frontend # 只构建前端
npm run test -w backend   # 只跑后端测试
```

## 测试

目前测试覆盖：

- 上传格式校验
- 视频时长限制
- 损坏视频错误处理
- job 查询 API
- render styleConfig 校验
- SQLite store 持久化和排序

运行：

```bash
npm run test
```

## 注意

- 现在真正可跑的后端还是 `backend`，不是 `backend-rs`。
- `backend-rs` 是迁移骨架，别直接拿它替换现有后端。
- `node:sqlite` 目前会打印 experimental warning，测试是能过的。
- Dockerfile 已经换到 Node 22，不然 `node:sqlite` 跑不了。
