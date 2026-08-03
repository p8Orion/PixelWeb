# PixelWeb — runtime image (expects prebuilt ./dist from `npm run build`)
FROM node:22-bookworm-slim

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3001

# Native deps for sharp (optional prebuild fallback)
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci --omit=dev \
    && npm install tsx@4.19.2 \
    && apt-get purge -y python3 make g++ \
    && apt-get autoremove -y \
    && rm -rf /var/lib/apt/lists/* /root/.npm

COPY dist ./dist
COPY server ./server
COPY shared ./shared
COPY tsconfig.json ./
COPY data/interpreted ./data/interpreted
COPY data/worlds/earth3x/interpreted ./data/worlds/earth3x/interpreted

EXPOSE 3001
CMD ["npx", "tsx", "server/index.ts"]
