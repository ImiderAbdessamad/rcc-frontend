# Build:  docker build -t rcc-frontend .
# Run (API WFB déjà sur l'hôte :8002) :
#   docker run --rm -p 8081:80 -e API_UPSTREAM=http://host.docker.internal:8002 rcc-frontend
# Avec la stack WFB : docker compose --profile rcc up --build  (port 8081)

FROM node:22-alpine AS build

WORKDIR /src

COPY package.json package-lock.json ./
RUN npm ci

COPY index.html vite.config.js postcss.config.js ./
COPY src ./src

RUN npm run build

FROM nginx:1.27-alpine

ENV API_UPSTREAM=http://host.docker.internal:8002

RUN apk add --no-cache wget \
    && rm -f /etc/nginx/conf.d/default.conf

COPY nginx.conf /etc/nginx/default.conf.tpl
COPY docker-entrypoint.sh /docker-entrypoint.sh
COPY --from=build /src/dist /usr/share/nginx/html

RUN chmod +x /docker-entrypoint.sh

EXPOSE 80

HEALTHCHECK --interval=20s --timeout=5s --start-period=10s --retries=5 \
    CMD wget -qO- http://127.0.0.1/ >/dev/null || exit 1

ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["nginx", "-g", "daemon off;"]
