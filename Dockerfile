FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY client/package.json client/
RUN npm ci
COPY shared shared
COPY server server
COPY client client
RUN npm run build -w client

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/shared shared
COPY --from=build /app/server server
COPY --from=build /app/client/dist client/dist
COPY --from=build /app/client/package.json client/
RUN npm ci --omit=dev -w server -w shared && npm cache clean --force
EXPOSE 4321
CMD ["npx", "tsx", "server/src/index.ts"]
