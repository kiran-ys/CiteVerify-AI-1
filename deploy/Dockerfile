# Builds the CiteVerify API and web app from the monorepo root:
#   docker build -f deploy/Dockerfile --target api .
#   docker build -f deploy/Dockerfile --target web .
FROM oven/bun:1.4.4 AS build
WORKDIR /app
COPY . .
RUN bun install --frozen-lockfile
RUN bun run build

# API: a single bundled file; no source, dev dependencies or .env in the image.
FROM oven/bun:1.4.4-slim AS api
WORKDIR /app
ENV NODE_ENV=production API_PORT=3001
COPY --from=build /app/apps/api/dist ./dist
USER bun
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s CMD ["bun", "-e", "fetch('http://127.0.0.1:3001/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["bun", "dist/index.js"]

# Web: static files served by Caddy, which also proxies /api to the API
# (same origin, so no CORS is needed).
FROM caddy:2-alpine AS web
COPY deploy/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/apps/web/dist /srv
