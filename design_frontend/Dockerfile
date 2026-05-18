FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json ./
COPY package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund \
    || npm install --omit=dev --no-audit --no-fund --legacy-peer-deps

FROM node:20-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN (npm install --include=dev --no-audit --no-fund \
     || npm install --include=dev --no-audit --no-fund --legacy-peer-deps) \
    && mkdir -p public \
    && npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000

COPY --from=build /app/public ./public
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static

EXPOSE 3000
CMD ["node", "server.js"]
