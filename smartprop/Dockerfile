# Optimized Multi-stage Dockerfile for SmartProp
# Fixes: duplicate installs, layer caching, build context

# Stage 1: Base with system dependencies
FROM debian:bookworm AS base

# Install bun
RUN apt-get update && apt-get install -y curl unzip
ENV BUN_INSTALL=/usr/local
RUN curl -fsSL https://bun.sh/install | bash
ENV PATH="/usr/local/bin:$PATH"

WORKDIR /app





# Install all system dependencies in one layer
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
    libcairo2-dev \
    libpango1.0-dev \
    libjpeg62-turbo-dev \
    libgif-dev \
    librsvg2-dev \
    python3 \
    make \
    g++ \
    pkg-config \
    dumb-init && \
    rm -rf /var/lib/apt/lists/*

# Stage 2: Dependencies (SINGLE install)
FROM base AS deps

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --ignore-scripts

# Rebuild the source code only when needed
FROM base AS builder

WORKDIR /app

COPY . .

COPY --from=deps /app/node_modules ./node_modules

# Build the application
WORKDIR /app/src
RUN bun run build

# Stage 4: Production runtime
FROM node:18-bullseye-slim AS runtime



# Create non-root user
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

# Install runtime system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    libcairo2 \
    libpango-1.0-0 \
    libjpeg62-turbo \
    libgif7 \
    librsvg2-2 \
    dumb-init && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy built application and dependencies from previous stages
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=deps --chown=nextjs:nodejs /app/node_modules ./node_modules

# Copy configuration
COPY --from=builder --chown=nextjs:nodejs /app/package.json ./

# Create necessary directories
RUN mkdir -p /app/storage /app/logs && \
    chown -R nextjs:nodejs /app/storage /app/logs

# Environment variables
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

# Switch to non-root user
USER nextjs

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD node --version || exit 1

# Use dumb-init and start application
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "server.js"]