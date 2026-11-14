FROM node:24-alpine AS build
WORKDIR /opt/football/app
COPY app/package.json app/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY app/ ./
RUN npm run build

FROM node:24-alpine AS production-deps
WORKDIR /opt/football/app
COPY app/package.json app/package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

FROM node:24-alpine AS runtime
ENV NODE_ENV=production HOST=0.0.0.0 PORT=13001 FOOTBALL_DB_PATH=/data/football.sqlite
WORKDIR /opt/football
COPY --from=production-deps /opt/football/app/node_modules ./app/node_modules
COPY app/package.json ./app/package.json
COPY server/ ./server/
COPY scripts/ ./scripts/
COPY --from=build /opt/football/app/dist ./app/dist
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 13001
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s CMD node -e "fetch('http://127.0.0.1:13001/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server/index.mjs"]
