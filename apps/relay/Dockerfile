# Untested template — review on first real deploy (docs/architecture/relay.md).
# Build context: apps/relay (standalone — resolves deps from npm, not the
# workspace lockfile).
FROM node:22-slim

WORKDIR /app
ENV NODE_ENV=production
ENV DATA_DIR=/data

COPY package.json ./
# pnpm 10 blocks dependency build scripts by default; better-sqlite3 needs its
# native build (prebuilds via prebuild-install). Allowing all builds here is
# the template shortcut — the tidier fix is `pnpm.onlyBuiltDependencies` in
# package.json or an interactive `pnpm approve-builds`.
RUN corepack enable \
  && corepack prepare pnpm@10.17.0 --activate \
  && echo "dangerously-allow-all-builds=true" >> .npmrc \
  && pnpm install --prod

COPY src ./src

EXPOSE 8787
VOLUME /data

CMD ["node", "--experimental-strip-types", "src/main.ts"]
