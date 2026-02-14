FROM node:20-bookworm-slim AS base

WORKDIR /app

COPY package.json ./package.json
COPY backend/package.json ./backend/package.json
COPY frontend/package.json ./frontend/package.json
RUN npm install

COPY frontend ./frontend
ARG NEXT_PUBLIC_API_BASE_URL=http://localhost:4000
ENV NEXT_PUBLIC_API_BASE_URL=${NEXT_PUBLIC_API_BASE_URL}
RUN npm run build -w frontend

WORKDIR /app/frontend
EXPOSE 3000
CMD ["npm", "run", "start"]
