# EasyMode — Docker runtime for Render.
# Why Docker: the UGC ad pipeline needs a FULL ffmpeg (drawtext/freetype for
# burned-in captions). npm's static Linux build lacks filters; Debian's ffmpeg
# has the complete set. openssl is required by Prisma on slim images.
FROM node:20-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npx prisma generate && npm run build

# yt-dlp + Deno for the Lyric Video's "paste a YouTube link" (scripts/fetch-yt-dlp.mjs): the newest releases on
# every build (YouTube changes often), each checked against its published SHA-256. Never fails the build —
# without them a link is answered "upload the song file instead".
RUN node scripts/fetch-yt-dlp.mjs /usr/local/bin || true

ENV NODE_ENV=production
EXPOSE 3000

# schema sync then serve (mirrors the previous render.yaml commands);
# remix-serve binds to Render's provided PORT automatically.
# mkdir first: the persistent disk mounts EMPTY at /app/data/renders — make
# sure the dir exists and is writable before anything touches it.
# `exec` (2026-11-25): the server REPLACES the shell, so Render's SIGTERM on a deploy reaches node (npx forwards it to
# remix-serve), and the worker can mark its running jobs "stopped by a deploy" and take no new one (worker.server.ts →
# stopTakingJobs; job-stall.ts: a deploy is not a stall). As PID 1 a shell that does not exec ignores SIGTERM, and the
# app only ever saw the SIGKILL 30 s later.
CMD ["sh", "-c", "mkdir -p /app/data/renders && npx prisma db push --accept-data-loss && exec npx remix-serve ./build/server/index.js"]
