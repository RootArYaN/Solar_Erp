# syntax=docker/dockerfile:1.7

ARG NODE_IMAGE=node:22.13.1-alpine
ARG NGINX_IMAGE=nginxinc/nginx-unprivileged:1.27.4-alpine

FROM ${NODE_IMAGE} AS build

ENV NODE_ENV=production
WORKDIR /build

COPY package.json package-lock.json ./
# TypeScript and Vite are build-time devDependencies. NODE_ENV remains
# production for the bundle, while --include=dev keeps those tools available
# only in this disposable build stage.
RUN npm ci --include=dev

COPY . .
RUN npm run build

FROM ${NGINX_IMAGE} AS runtime

COPY nginx.conf /etc/nginx/nginx.conf
COPY security-headers.conf /etc/nginx/security-headers.conf
COPY --from=build /build/dist /usr/share/nginx/html

USER 101:101
EXPOSE 8080

HEALTHCHECK --interval=20s --timeout=5s --start-period=10s --retries=3 \
    CMD ["wget", "-q", "-O", "/dev/null", "http://127.0.0.1:8080/healthz"]
