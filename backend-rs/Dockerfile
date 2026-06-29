FROM rust:1.96-bookworm AS builder

WORKDIR /app
COPY backend-rs ./backend-rs
RUN cargo build --release --manifest-path backend-rs/Cargo.toml

FROM debian:bookworm-slim AS runtime

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates ffmpeg fonts-noto-cjk \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=builder /app/backend-rs/target/release/autobbq-backend /usr/local/bin/autobbq-backend

ENV PORT=4000
ENV STORAGE_DIR=/app/storage
ENV DATABASE_URL=sqlite:/app/storage/data/autobbq.sqlite
EXPOSE 4000

CMD ["autobbq-backend"]
