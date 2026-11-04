# 서버(사내 71번)는 Docker Hub 차단 — 베이스 이미지는 amd64 tar로 반입(docker load)한다.
# 파서 지시어(syntax 선언) 금지: 빌드마다 docker/dockerfile 프런트엔드 이미지를 레지스트리에서 찾아 프룬 뒤 빌드가 죽는다. 내장 파서로 충분.
# 정확한 패치 버전으로 고정한다: 서버는 반입한 tar가 곧 버전이라 `24-alpine` 같은 유동 태그는 옛 tar로 조용히 빌드된다.
# 올릴 때는 FROM 세 줄과 서버 tar 반입을 같이 바꾼다(bpm과 같은 태그를 쓰면 서버에 이미 있다).
FROM node:24.22.1-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci

FROM node:24.22.1-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# 인증 모드는 백엔드가 런타임에 GET /api/auth/mode로 알려준다 — 빌드 타임 인라인 불필요.
RUN npm run build

# standalone 산출물만 담은 런타임 이미지 (next.config.ts output: "standalone")
FROM node:24.22.1-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
# public/은 비어 있어도 .gitkeep으로 저장소에 둔다 — 없으면 이 COPY가 빌드를 깨고, 나중에 정적 파일을 넣어도 조용히 빠지지 않는다.
COPY --from=builder /app/public ./public

# node 이미지에 내장된 비루트 사용자
USER node

EXPOSE 3000
CMD ["node", "server.js"]
