# Node major version must match .nvmrc
FROM node:24-alpine AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build && pnpm prune --prod

FROM node:24-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/src/database/migrations ./src/database/migrations
USER node
EXPOSE 3000
# Migrations run as a separate step before start, as studio_desk_owner:
#   docker run ... <image> node dist/database/migrate.js
CMD ["node", "dist/main.js"]
