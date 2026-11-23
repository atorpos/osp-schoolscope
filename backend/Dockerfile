FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci --no-audit --no-fund
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
RUN addgroup -S app && adduser -S app -G app \
    && mkdir -p /app/storage && chown app:app /app/storage
COPY package*.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY data ./data
USER app
EXPOSE 4000
CMD ["node", "dist/server.js"]
