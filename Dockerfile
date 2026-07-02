# ---- Build stage ----
FROM node:22-alpine AS builder
WORKDIR /app

# Prisma engines on Alpine need these
RUN apk add --no-cache libc6-compat openssl

COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci

COPY . .
RUN npx prisma generate && npm run build

# ---- Runtime stage ----
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN apk add --no-cache libc6-compat openssl

# Prisma CLI for `migrate deploy` on container start
RUN npm install -g prisma@6.19.3

COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
COPY --from=builder /app/prisma ./prisma

# Uploads live on a bind mount; create the mount point with app ownership
RUN mkdir -p /data/uploads && chown -R node:node /data/uploads /app

USER node
EXPOSE 3000

# Migrations run automatically on every start — no manual step to forget.
CMD ["sh", "-c", "prisma migrate deploy && node server.js"]
