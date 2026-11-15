# Local development image. The release workflow uses Dockerfile.release with a
# prebuilt dist/ so it can cross-build without running Node under emulation.
FROM docker.io/library/node:22-alpine AS build
WORKDIR /src

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM docker.io/library/nginx:1.27-alpine

ARG VERSION=dev
LABEL org.opencontainers.image.title="Series of Systems" \
      org.opencontainers.image.description="A cartoon browser game about systems engineering" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.source="https://git.chaops.de/seriesofsystems/seriesofsystems"

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /src/dist /usr/share/nginx/html

EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1/ >/dev/null || exit 1
