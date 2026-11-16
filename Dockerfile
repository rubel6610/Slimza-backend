
FROM node:26-alpine AS builder

WORKDIR /app

COPY package*.json ./

RUN npm ci

COPY . .

ENV DATABASE_URL="postgresql://build:build-only@localhost:5432/build_db"

RUN npx prisma generate

RUN npm run build


# Production stage
FROM node:26-alpine AS production

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=4000

COPY package*.json ./

RUN npm ci --omit=dev && npm cache clean --force

COPY --from=builder --chown=node:node /app/dist ./dist

RUN mkdir -p /app/uploads \
    && chown -R node:node /app/uploads

USER node

EXPOSE 4000

CMD ["node", "dist/main.js"]
