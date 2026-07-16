# Étape 1 : build workspaces (client Vite + serveur esbuild bundlé)
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/server/package.json apps/server/
COPY apps/client/package.json apps/client/
RUN npm ci
COPY . .
RUN npm run build

# Étape 2 : image finale sans node_modules (le serveur est un bundle autonome)
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080
COPY --from=build /app/apps/server/dist ./apps/server/dist
COPY --from=build /app/apps/client/dist ./apps/client/dist
EXPOSE 8080
CMD ["node", "apps/server/dist/index.cjs"]
