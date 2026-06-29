CREATE TABLE IF NOT EXISTS videos (
  id TEXT PRIMARY KEY,
  original_filename TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  original_path TEXT NOT NULL,
  original_url TEXT NOT NULL,
  duration_sec REAL NOT NULL,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  fps REAL NOT NULL,
  subtitle_en_path TEXT,
  subtitle_en_url TEXT,
  subtitle_zh_path TEXT,
  subtitle_zh_url TEXT,
  output_path TEXT,
  output_url TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_videos_created_at ON videos(created_at DESC);
