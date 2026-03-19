FROM oven/bun:1.1 AS builder
WORKDIR /app
COPY package.json bun.lockb* package-lock.json* ./
RUN bun install --frozen-lockfile
COPY . .
RUN bun build src/index.ts --outdir dist --target bun

FROM oven/bun:1.1-slim
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules

EXPOSE 3000
VOLUME ["/data/memory", "/data/workspaces", "/data/logs"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD curl -f http://localhost:3000/health || exit 1

CMD ["bun", "dist/index.js"]
