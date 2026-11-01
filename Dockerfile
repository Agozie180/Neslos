FROM node:24.22.2-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:24.22.2-bookworm-slim AS runtime
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY --from=build /app/fixtures ./fixtures
ENV HOST=0.0.0.0 PORT=8787 NESLOS_MODE=rehearsal
USER node
EXPOSE 8787
CMD ["node", "dist/server/server/index.js"]
