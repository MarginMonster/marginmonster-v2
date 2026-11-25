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
# NODE ITSELF IS THE SERVER PROCESS (2026-11-25), so Render's SIGTERM on a deploy reaches the app: the worker marks its
# running jobs "stopped by a deploy" and takes no new one (worker.server.ts → stopTakingJobs; job-stall.ts: a deploy is
# not a stall), remix-serve closes its listener, and a render in flight has Render's 30 s grace. `exec npx remix-serve`
# was tried first and LOOKED at on the live log: npx runs the bin through ANOTHER shell, that shell took the signal and
# died ("npm error signal SIGTERM" at 18:17:24 ET), and the worker never heard it. remix-serve's own bin is
# dist/cli.js (its package.json "bin"); it reads the build path from argv[2] and PORT from the environment, exactly as
# the bin does.
CMD ["sh", "-c", "mkdir -p /app/data/renders && npx prisma db push --accept-data-loss && exec node ./node_modules/@remix-run/serve/dist/cli.js ./build/server/index.js"]
