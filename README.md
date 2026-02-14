# AutoBBQ (Next.js + Express + BullMQ + FFmpeg)

一个可本地运行的字幕处理 MVP：

1. 上传英文视频（`mp4/mov/webm`，<= 5 分钟）
2. 后端提取英文字幕（ASR）
3. 翻译为中文字幕并生成 `VTT/SRT`
4. 前端实时预览并编辑字幕样式
5. 生成并下载烧录中文字幕的视频

## 技术栈

- Frontend: Next.js + React + TypeScript
- Backend: Express + TypeScript
- Queue: BullMQ + Redis
- Media: FFmpeg / FFprobe
- Subtitle: WebVTT + SRT + ASS
- Provider: Mock + OpenAI-compatible（可插拔）

## 目录结构

```txt
.
├── backend
│   ├── src
│   ├── storage
│   └── .env.example
├── frontend
│   ├── app
│   ├── components
│   └── .env.example
├── .env.example
├── docker-compose.yml
└── README.md
```

## 本地运行配置 (Localization & Setup)

为了让项目在任何电脑可运行，配置已做抽象，你只需要配置环境变量。

### 1) 必填/可选变量（根目录 `.env`）

先复制模板：

```bash
cp .env.example .env
```

然后按需修改以下变量：

- `PORT`: 后端端口（默认 `4000`）
- `API_BASE_URL`: 后端对外地址（默认 `http://localhost:4000`）
- `FRONTEND_ORIGIN`: 前端地址（默认 `http://localhost:3000`）
- `REDIS_URL`: Redis 地址（本机默认 `redis://localhost:6379`）
- `STORAGE_DIR`: 媒体存储目录（默认 `storage`，相对 backend 目录）
- `ASR_PROVIDER`: `mock` 或 `openai`
- `TRANSLATION_PROVIDER`: `mock` 或 `openai`
- `OPENAI_API_KEY`: 使用真实模型时填写
- `OPENAI_BASE_URL`: OpenAI 或 OpenAI-compatible 网关
- `OPENAI_ASR_MODEL`: ASR 模型名
- `OPENAI_TRANSLATION_MODEL`: 翻译模型名
- `NEXT_PUBLIC_API_BASE_URL`: 前端调用后端地址（默认 `http://localhost:4000`）

### 2) 最简步骤

1. 第一步：复制模板并编辑
   - `cp .env.example .env`
2. 第二步：启动依赖与服务
   - Docker 推荐：`docker compose up --build`
3. 第三步：浏览器打开
   - `http://localhost:3000`

### 3) 已抽象处理的部分

- Provider 抽象：ASR/翻译通过接口解耦，可切换 `mock` 或 OpenAI-compatible
- 存储路径抽象：通过 `STORAGE_DIR` 控制，不再依赖某台机器绝对路径
- API 地址抽象：通过 `API_BASE_URL`、`NEXT_PUBLIC_API_BASE_URL` 控制
- 任务队列抽象：BullMQ + Redis，业务流程与执行器分离

## 快速启动（Docker 推荐）

```bash
docker compose up --build
```

启动后：

- Frontend: [http://localhost:3000](http://localhost:3000)
- Backend: [http://localhost:4000](http://localhost:4000)
- Redis: `localhost:6379`

停止：

```bash
docker compose down
```

## 本地运行（非 Docker）

### 1) 安装依赖

```bash
npm install
```

### 2) 前端环境文件（可选）

如果你不是用默认后端地址，可执行：

```bash
cp frontend/.env.example frontend/.env.local
```

### 3) 启动 Redis

确保本地 Redis 运行在 `6379`（或修改 `.env` 的 `REDIS_URL`）。

### 4) 安装 FFmpeg

macOS:

```bash
brew install ffmpeg
```

Ubuntu/Debian:

```bash
sudo apt-get update && sudo apt-get install -y ffmpeg fonts-noto-cjk
```

### 5) 启动前后端

```bash
npm run dev
```

## API 概览

### `POST /api/videos/upload`

- form-data: `file`
- 校验：格式白名单 + 时长 <= 300 秒
- 返回：`videoId`, `originalUrl`, `durationSec`

### `POST /api/videos/:id/process`

- 异步任务：ASR -> 翻译 -> 生成字幕
- 返回：`jobId`

### `GET /api/jobs/:jobId`

- 返回：`status/progress/error/result`
- `status`: `queued | running | succeeded | failed`

### `POST /api/videos/:id/render`

- 请求体：`styleConfig`
- 返回：`jobId`

### `GET /api/videos/:id/output`

- 返回：最终视频 `outputUrl`

## Provider 配置

### 离线可跑（Mock）

```env
ASR_PROVIDER=mock
TRANSLATION_PROVIDER=mock
```

### 真实模型（OpenAI-compatible）

```env
ASR_PROVIDER=openai
TRANSLATION_PROVIDER=openai
OPENAI_API_KEY=your_api_key
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_ASR_MODEL=gpt-4o-mini-transcribe
OPENAI_TRANSLATION_MODEL=gpt-4o-mini
```

## 测试

```bash
npm run test
```

覆盖项包括：

- 上传校验（格式/时长/损坏文件）
- styleConfig 校验
- job 状态查询

## 安全与开源注意事项


