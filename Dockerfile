
FROM node:24-alpine AS builder

WORKDIR /app

COPY package*.json ./

RUN npm ci

COPY . .

ENV DATABASE_URL="mysql://build:build-only@localhost:3306/build_db"

RUN npx prisma generate

RUN npm run build


# Production stage
FROM node:24-alpine AS production

WORKDIR /app

ENV NODE_ENV=production

ENV PORT=5173

COPY package*.json ./

RUN npm ci --omit=dev && npm cache clean --force

COPY --from=builder --chown=node:node /app/dist ./dist

# Uploaded files live in MinIO (S3_*), not on disk.

USER node

EXPOSE 5173

CMD ["node", "dist/main.js"]