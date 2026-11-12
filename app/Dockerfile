# Build from the repository root: docker build -f app/Dockerfile -t football-club .
FROM node:24-alpine AS build
WORKDIR /opt/football/app
COPY app/package.json app/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY app/ ./
RUN npm run build

FROM node:24-alpine
ENV NODE_ENV=production HOST=0.0.0.0 PORT=13001 FOOTBALL_DB_PATH=/data/football.sqlite
WORKDIR /opt/football
COPY server/ ./server/
COPY scripts/ ./scripts/
COPY --from=build /opt/football/app/dist ./app/dist
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 13001
CMD ["node", "server/index.mjs"]
