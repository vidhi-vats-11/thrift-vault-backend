# syntax=docker/dockerfile:1

# --------------------------------------------------------------------------
# Base: Alpine + OpenSSL. Prisma's query engine is linked against OpenSSL and
# will not load on musl without it.
# --------------------------------------------------------------------------
FROM node:20-alpine AS base
WORKDIR /app
RUN apk add --no-cache openssl

# --------------------------------------------------------------------------
# deps: production dependency tree + generated Prisma Client.
#
# The schema is copied BEFORE `npm ci` on purpose: package.json's
# `postinstall` runs `prisma generate`, which needs prisma/schema.prisma to
# exist. `prisma` is a real dependency (not a devDependency) because the Fly
# release_command runs `prisma migrate deploy` from this same image.
# --------------------------------------------------------------------------
FROM base AS deps
COPY package.json package-lock.json ./
COPY prisma ./prisma

# Belt and braces: `prisma generate` itself tolerates unset datasource env vars,
# but any schema command that goes through full validation (`prisma validate`)
# hard-fails with P1012. Generation never opens a connection, so placeholders are
# enough — and no real credential is baked into a layer.
ENV DATABASE_URL="postgresql://placeholder:placeholder@localhost:5432/placeholder" \
    DATABASE_URL_UNPOOLED="postgresql://placeholder:placeholder@localhost:5432/placeholder"

# `npm ci` (not `npm install`) so the lockfile is authoritative. Install scripts
# stay enabled: @prisma/engines downloads the query engine in its postinstall.
RUN npm ci --omit=dev --no-audit --no-fund

# Explicit and idempotent: fails the build loudly if the client is ever missing,
# instead of relying on the postinstall hook alone. `--no-install` guarantees the
# locally installed CLI is used rather than npx fetching one from the registry.
RUN npx --no-install prisma generate

# --------------------------------------------------------------------------
# runner
# --------------------------------------------------------------------------
FROM base AS runner
ENV NODE_ENV=production
ENV PORT=4000

COPY --from=deps --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node package.json package-lock.json ./
COPY --chown=node:node prisma ./prisma
COPY --chown=node:node src ./src

# Only used when BLOB_READ_WRITE_TOKEN is unset (local-disk image fallback).
# On Fly this filesystem is ephemeral — see fly.toml / .env.example.
RUN mkdir -p /app/uploads && chown node:node /app/uploads

USER node

EXPOSE 4000
CMD ["node", "src/server.js"]
