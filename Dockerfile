# AdArcade — Docker runtime for Render.
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

ENV NODE_ENV=production
EXPOSE 3000

# schema sync then serve (mirrors the previous render.yaml commands);
# remix-serve binds to Render's provided PORT automatically
CMD ["sh", "-c", "npx prisma db push --accept-data-loss && npx remix-serve ./build/server/index.js"]
