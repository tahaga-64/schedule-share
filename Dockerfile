FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY index.html tsconfig.json vite.config.ts ./
COPY config ./config
COPY src ./src
COPY public ./public
COPY scripts ./scripts
COPY server ./server
RUN npm run build

FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3217 APP_ACCESS_MODE=link DATA_DIR=/data
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund
COPY --from=build /app/dist ./dist
COPY --from=build /app/server ./server
COPY --from=build /app/scripts/backup.mjs ./scripts/backup.mjs
COPY --from=build /app/scripts/links.mjs ./scripts/links.mjs
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME ["/data"]
EXPOSE 3217
CMD ["node","server/index.mjs"]
