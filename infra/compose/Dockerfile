FROM node:22-bookworm@sha256:363e1587494626837fa7f9a23bdb453d13b0ff3c67c705c2805cfc69c2d2fad7
# Debian publishes security fixes before the Node image is rebuilt with them.
RUN apt-get update && apt-get upgrade -y && rm -rf /var/lib/apt/lists/*
# Corepack keeps pnpm here instead of in root's home, so USER node finds the copy installed below
# and containers don't download pnpm on every start.
ENV COREPACK_HOME=/usr/local/share/corepack
RUN corepack enable
WORKDIR /app
# Normalize modes: a restrictive host umask (e.g. 077 on hardened hosts) would otherwise
# leave the copied tree unreadable to USER node at runtime.
COPY --chmod=755 . .
# The pnpm version package.json pins.
RUN corepack install && chmod -R a+rX "$COREPACK_HOME"
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @rakazo/db generate
RUN RAKAZO_ALLOW_DEV_SECRETS=1 pnpm --filter @rakazo/web build
RUN install -d -m 750 -o node -g node /data /app/apps/web/node_modules/.vite-temp
ARG GIT_SHA
ENV NODE_ENV=production
ENV GIT_SHA=$GIT_SHA
EXPOSE 3100 5173 7091
USER node
CMD ["pnpm", "--filter", "@rakazo/api", "start"]
