# syntax=docker/dockerfile:1
FROM node:22-alpine AS build
WORKDIR /app
COPY . .
RUN --mount=type=secret,id=proxy_ca \
    if [ -f /run/secrets/proxy_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/proxy_ca; fi; \
    npm ci --ignore-scripts && npm run build && npm prune --omit=dev --ignore-scripts && \
    mkdir -p /runtime/apps/api /runtime/apps/web /runtime/packages/shared /runtime/database && \
    cp -a node_modules package.json package-lock.json /runtime/ && \
    cp -a apps/api/package.json apps/api/dist /runtime/apps/api/ && \
    cp -a apps/web/package.json /runtime/apps/web/ && \
    cp -a packages/shared/package.json packages/shared/dist /runtime/packages/shared/ && \
    cp -a database/migrations /runtime/database/

FROM node:22-alpine AS api
WORKDIR /app
ENV NODE_ENV=production API_HOST=0.0.0.0 API_PORT=3001
COPY --from=build --chown=node:node /runtime/ /app/
USER node
EXPOSE 3001
HEALTHCHECK --interval=10s --timeout=5s --start-period=15s --retries=6 CMD ["node", "-e", "fetch('http://127.0.0.1:3001/api/ready').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
CMD ["node", "apps/api/dist/server.js"]

FROM caddy:2.10-alpine AS web
COPY deploy/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/apps/web/dist /srv
