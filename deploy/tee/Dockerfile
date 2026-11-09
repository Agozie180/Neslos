FROM node:24.22.2-bookworm-slim@sha256:c86ecead9e55a5210ac1727de38a4ca840bf03dcaf34dc9749addbf383b1920c AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY tsconfig.json tsconfig.server.json ./
COPY src ./src
RUN node node_modules/typescript/bin/tsc -p tsconfig.server.json

FROM node:24.22.2-bookworm-slim@sha256:c86ecead9e55a5210ac1727de38a4ca840bf03dcaf34dc9749addbf383b1920c AS runtime
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund && npm cache clean --force && mkdir /data && chown node:node /data
COPY --from=build /app/dist/server ./dist/server
COPY fixtures ./fixtures
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8443 NESLOS_JOURNAL=/data/neslos-audit.json
USER node
EXPOSE 8443
CMD ["node", "dist/server/tee/index.js"]
