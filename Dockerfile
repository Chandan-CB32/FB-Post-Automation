# Multi-stage Dockerfile for FB Post Automation System (Dashboard + 24/7 Worker)
FROM node:20-bookworm-slim AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

# Stage 1: Dependencies and Build
FROM base AS build
WORKDIR /app

# Copy package manifests
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY packages/core/package.json ./packages/core/
COPY packages/core/tsconfig.json ./packages/core/
COPY worker/package.json ./worker/
COPY worker/tsconfig.json ./worker/
COPY apps/web/package.json ./apps/web/
COPY apps/web/tsconfig.json ./apps/web/

RUN pnpm install --frozen-lockfile

# Copy source code
COPY packages/core ./packages/core
COPY worker ./worker
COPY apps/web ./apps/web

# Build all packages
RUN pnpm -r run build

# Stage 2: Production Runner
FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production

COPY --from=build /app/package.json ./package.json
COPY --from=build /app/pnpm-workspace.yaml ./pnpm-workspace.yaml
COPY --from=build /app/pnpm-lock.yaml ./pnpm-lock.yaml
COPY --from=build /app/packages/core/package.json ./packages/core/
COPY --from=build /app/packages/core/dist ./packages/core/dist
COPY --from=build /app/worker/package.json ./worker/
COPY --from=build /app/worker/dist ./worker/dist
COPY --from=build /app/apps/web/package.json ./apps/web/
COPY --from=build /app/apps/web/dist ./apps/web/dist
COPY --from=build /app/start.mjs ./start.mjs

# Production dependencies only
RUN pnpm install --prod --frozen-lockfile

# Create persistent data directory
RUN mkdir -p /app/data

EXPOSE 3000

# Runs both the Web Dashboard and the 24/7 Autonomous Publisher concurrently
CMD ["node", "start.mjs"]
