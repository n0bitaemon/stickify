# ── Build ────────────────────────────────────────────────────────────────
FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY server/package*.json server/
COPY web/package*.json web/
RUN npm ci --prefix server && npm ci --prefix web
COPY server server
COPY web web
RUN npm run build --prefix server && npm run build --prefix web \
 && npm prune --omit=dev --prefix server

# ── Runtime ──────────────────────────────────────────────────────────────
FROM node:24-bookworm-slim
# Debian's ffmpeg ships libvpx (VP9 + alpha) and APNG.
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app/server
ENV NODE_ENV=production PORT=4000 STORAGE_DIR=/data WEB_DIST_DIR=/app/web/dist
COPY --from=build /app/server/node_modules ./node_modules
COPY --from=build /app/server/dist ./dist
COPY --from=build /app/server/package.json ./
COPY --from=build /app/web/dist /app/web/dist
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 4000
CMD ["node", "dist/main.js"]
