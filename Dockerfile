# The image exists so a month end run is reproducible on a machine that has
# nothing but docker. It is not a service: there is no port and no daemon.
FROM node:20.18.2-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:20.18.2-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY bin ./bin
COPY src ./src
COPY examples ./examples
RUN chown -R node:node /app
USER node
ENTRYPOINT ["node", "/app/bin/spurtally.js"]
CMD ["--help"]
