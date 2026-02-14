#!/usr/bin/env bash
set -euo pipefail

OUTPUT_PATH="${1:-./backend/storage/temp/demo-en.mp4}"
mkdir -p "$(dirname "$OUTPUT_PATH")"

ffmpeg -y \
  -f lavfi -i color=c=black:s=1280x720:d=20 \
  -f lavfi -i sine=frequency=880:duration=20 \
  -shortest \
  -vf "drawtext=text='Demo English Video':fontcolor=white:fontsize=56:x=(w-text_w)/2:y=(h-text_h)/2" \
  -c:v libx264 -c:a aac -pix_fmt yuv420p \
  "$OUTPUT_PATH"

echo "Demo video generated at: $OUTPUT_PATH"
