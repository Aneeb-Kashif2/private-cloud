# syntax=docker/dockerfile:1
FROM node:22-bookworm-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app

FROM base AS build
COPY package.json package-lock.json ./
COPY backend/package.json ./backend/package.json
COPY frontend/package.json ./frontend/package.json
RUN npm ci --workspace backend
COPY backend ./backend
RUN npm run prisma:generate --workspace backend && npm run build --workspace backend
RUN npm prune --omit=dev --workspace backend

FROM base AS runtime
ENV NODE_ENV=production PORT=4000 STORAGE_PATH=/srv/secure-cloud-storage STORAGE_LIMIT_BYTES=5368709120
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/backend/package.json ./backend/package.json
COPY --from=build --chown=node:node /app/backend/dist ./backend/dist
COPY --from=build --chown=node:node /app/backend/prisma ./backend/prisma
RUN mkdir -p /srv/secure-cloud-storage && chown node:node /srv/secure-cloud-storage
WORKDIR /app/backend
USER node
EXPOSE 4000
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=5 CMD node -e "fetch('http://127.0.0.1:4000/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
# Compose runs migrations as a separate one-shot service before starting the API.
CMD ["node", "dist/src/server.js"]
