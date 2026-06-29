# Autobbq

Autobbq 是一个本地跑的英语视频字幕工具：上传视频，生成英文字幕，再翻译成中文字幕，最后可以把字幕烧录回视频里。

现在的项目结构已经切到 Rust + TypeScript + SQLite：后端是 Rust/Axum，前端是 Next.js，任务和视频数据存在 SQLite。Redis 和旧 TypeScript 后端已经不再需要。

## 现在能做什么

- 上传 mp4 / mov / webm 视频
- 读取视频时长、分辨率和帧率
- 调用 ASR 生成英文字幕
- 调用翻译模型生成中文字幕
- 导出 VTT / SRT 字幕文件
- 在浏览器里预览字幕位置、字号、描边和阴影
- 用 FFmpeg 把中文字幕烧录成新视频
- 在页面里临时修改 OpenAI-compatible API 配置

## 技术栈

| 部分 | 技术 |
| --- | --- |
| Frontend | Next.js 16, React, TypeScript |
| Backend | Rust, Axum, Tokio, SQLx |
| Database | SQLite |
| Media | FFmpeg / FFprobe |
| AI Provider | OpenAI-compatible API |
| Docker | Docker Compose |

## 目录

```text
.
├── backend-rs          # Rust 后端
│   ├── migrations      # SQLite schema
│   └── src/main.rs     # API、任务、字幕、渲染逻辑
├── frontend            # Next.js 前端
├── storage             # 上传文件、字幕、输出视频、SQLite 数据库
├── docker-compose.yml
└── package.json
```

## 本地运行

先准备：

- Node.js 22+
- Rust stable
- FFmpeg

macOS 可以这样装 FFmpeg 和 Rust：

```bash
brew install ffmpeg rust
```

安装前端依赖：

```bash
npm install
```

复制环境变量：

```bash
cp .env.example .env
```

启动前后端：

```bash
npm run dev
```

默认地址：

- Frontend: http://localhost:3000
- Backend: http://localhost:4000

如果 3000 被占用，可以单独给前端换端口：

```bash
cargo run --manifest-path backend-rs/Cargo.toml
npm run dev -w frontend -- -p 3002
```

## Docker

```bash
docker compose up --build
```

Docker 会启动两个服务：

- `autobbq-backend`: Rust 后端，端口 4000
- `autobbq-frontend`: Next.js 前端，端口 3000

运行数据挂载在项目根目录的 `storage/`。

## 环境变量

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PORT` | `4000` | Rust 后端端口 |
| `API_BASE_URL` | `http://localhost:4000` | 后端对外访问地址，用来拼接文件 URL |
| `MAX_DURATION_SEC` | `300` | 单个视频最长秒数 |
| `MAX_UPLOAD_SIZE_MB` | `300` | 上传大小限制 |
| `STORAGE_DIR` | `storage` | 文件和数据库存储目录 |
| `DATABASE_URL` | `sqlite:storage/data/autobbq.sqlite` | SQLite 地址 |
| `ASR_PROVIDER` | `mock` | `mock` 或 `openai` |
| `TRANSLATION_PROVIDER` | `mock` | `mock` 或 `openai` |
| `OPENAI_API_KEY` | 空 | OpenAI-compatible API key |
| `OPENAI_BASE_URL` | `https://api.openai.com/v1` | OpenAI-compatible base URL |
| `OPENAI_ASR_MODEL` | `gpt-4o-transcribe` | ASR 模型名 |
| `OPENAI_TRANSLATION_MODEL` | `gpt-5.4-mini` | 翻译模型名 |
| `NEXT_PUBLIC_API_BASE_URL` | `http://localhost:4000` | 前端访问后端的地址 |

开发时可以先保持 `ASR_PROVIDER=mock`、`TRANSLATION_PROVIDER=mock`，这样不需要 API key 也能跑完整流程。要接真实模型时，把两个 provider 改成 `openai`，再填 API key、base URL 和模型名。

## 模型配置参考

后端目前调用两类 OpenAI-compatible 接口：

- ASR: `POST /audio/transcriptions`
- 翻译: `POST /chat/completions`

常见配置可以这样填：

| 平台 | Base URL | ASR 示例 | 翻译示例 |
| --- | --- | --- | --- |
| OpenAI | `https://api.openai.com/v1` | `gpt-4o-transcribe`, `gpt-4o-mini-transcribe`, `whisper-1` | `gpt-5.5`, `gpt-5.4-mini`, `gpt-5.4-nano` |
| DashScope compatible mode | `https://dashscope.aliyuncs.com/compatible-mode/v1` | `qwen3.5-omni-plus` | `qwen3.7-plus`, `qwen3.6-flash`, `qwen3.7-max` |

只要平台兼容这两个接口，模型名可以在页面的 API 配置里直接改。只支持 Responses API 的模型暂时还不能直接接入，需要给 Rust 后端补一层 provider adapter。

## API

健康检查：

```bash
curl http://localhost:4000/health
```

上传视频：

```bash
curl -F "file=@demo.mp4" http://localhost:4000/api/videos/upload
```

生成字幕：

```bash
curl -X POST http://localhost:4000/api/videos/{videoId}/process
```

查询任务：

```bash
curl http://localhost:4000/api/jobs/{jobId}
```

渲染视频：

```bash
curl -X POST http://localhost:4000/api/videos/{videoId}/render \
  -H "Content-Type: application/json" \
  -d '{
    "fontSize": 42,
    "position": { "x": 0.5, "y": 0.82 },
    "maxWidthRatio": 0.9,
    "stroke": { "enabled": true, "width": 2 },
    "shadow": { "enabled": true, "opacity": 0.3 },
    "fontFamily": "Noto Sans SC",
    "fontColor": "#ffffff",
    "textAlign": "center"
  }'
```

## 测试和构建

跑完整检查：

```bash
npm run test
```

它会先跑 Rust 后端测试，再构建前端。

只跑 Rust 后端：

```bash
cargo test --manifest-path backend-rs/Cargo.toml
```

只构建前端：

```bash
npm run build -w frontend
```

生产构建：

```bash
npm run build
```

## 数据

运行时文件都在 `storage/`：

```text
storage/
├── uploads      # 原始视频
├── subtitles    # VTT / SRT 字幕
├── output       # 渲染后的视频
├── temp         # 临时文件
└── data         # SQLite 数据库
```

SQLite 文件默认是：

```text
storage/data/autobbq.sqlite
```

## 备注

- FFmpeg 必须能在命令行直接运行，否则视频分析和烧录会失败。
- 页面里的 API 配置是运行时配置，方便本地测试；长期部署还是建议写进 `.env`。
- `mock` provider 适合调 UI 和流程，不代表真实识别/翻译质量。
