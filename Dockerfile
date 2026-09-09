# syntax=docker/dockerfile:1
FROM --platform=$BUILDPLATFORM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY scripts/patch-sdk.mjs scripts/patch-sdk.mjs
RUN npm ci
COPY tsconfig.json tsconfig.server.json vite.config.ts index.html ./
COPY src src
COPY server server
COPY shared shared
COPY scripts scripts
COPY tests tests
COPY public public
RUN npm run build && npm run build:server

FROM node:24-bookworm-slim AS runtime-dependencies
WORKDIR /app
COPY package.json package-lock.json ./
COPY scripts/patch-sdk.mjs scripts/patch-sdk.mjs
RUN npm ci --omit=dev && npm cache clean --force

FROM node:24-bookworm-slim AS game
ENV NODE_ENV=production HOST=0.0.0.0 PORT=2567
WORKDIR /app
COPY --from=runtime-dependencies --chown=node:node /app/node_modules node_modules
COPY --chown=node:node package.json ./
COPY --from=build --chown=node:node /app/build-server ./
COPY --chown=node:node server/persistence/migrations server/persistence/migrations
USER node
EXPOSE 2567
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:2567/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server/index.js"]

FROM postgres:18-bookworm AS postgres
COPY --chmod=644 deploy/init-database.sh /docker-entrypoint-initdb.d/10-slop-city.sh
COPY --chmod=644 deploy/postgres-entrypoint.sh /usr/local/bin/slop-entrypoint.sh
ENTRYPOINT ["sh", "/usr/local/bin/slop-entrypoint.sh"]
CMD ["postgres"]

# TURN/TLS and HTTPS share port 443 using SNI, following LiveKit's VM design.
FROM --platform=$BUILDPLATFORM caddy:2.11.4-builder AS caddy-build
ARG TARGETOS
ARG TARGETARCH
RUN GOOS=$TARGETOS GOARCH=$TARGETARCH xcaddy build v2.11.4 --with github.com/mholt/caddy-l4@v0.1.2

FROM caddy:2.11.4 AS edge
COPY --from=caddy-build /usr/bin/caddy /usr/bin/caddy
COPY --from=build /app/dist /srv
CMD ["caddy", "run", "--config", "/etc/caddy/slop-city.json"]
