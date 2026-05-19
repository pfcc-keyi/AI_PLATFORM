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
# NEXT_PUBLIC_* values are inlined into the JS bundle at build time, so
# Railway-defined service variables must be re-declared as build ARGs and
# promoted to ENV before `next build` runs. Without this, the bundle ships
# with `process.env.NEXT_PUBLIC_AI_API_URL === ""` and the frontend will
# call its own origin and 404. See README for details.
ARG NEXT_PUBLIC_AI_API_URL=""
ENV NEXT_PUBLIC_AI_API_URL=$NEXT_PUBLIC_AI_API_URL
ENV NEXT_TELEMETRY_DISABLED=1
RUN (npm install --include=dev --no-audit --no-fund \
     || npm install --include=dev --no-audit --no-fund --legacy-peer-deps) \
    && mkdir -p public \
    && echo "Building with NEXT_PUBLIC_AI_API_URL=${NEXT_PUBLIC_AI_API_URL:-<empty>}" \
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
