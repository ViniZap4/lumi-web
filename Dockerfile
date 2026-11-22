# web-client/Dockerfile
#
# Mudanças: imagens fixadas por versão exata (antes node:20-alpine e nginx:alpine,
# flutuantes) e Node 22 (Vite 7 pede Node 20.19+/22.12+). O nginx continua na
# porta 80: o deploy (deploy/tailscale/web.json no guarda-chuva) aponta para
# 127.0.0.1:80. Trocar por nginxinc/nginx-unprivileged (porta 8080) exige mudar
# web.json e o healthcheck do compose.prod.yaml no mesmo passo.
FROM node:22.23.5-alpine3.24 AS builder

WORKDIR /app
COPY package*.json ./
RUN npm ci --no-audit --no-fund

# Embutido no bundle (import.meta.env) no build. O deploy passa
# https://lumi-api.<tailnet>.ts.net.
ARG VITE_LUMI_SERVER_URL=http://localhost:8080

COPY . .
RUN npm run build

FROM nginx:1.30.7-alpine3.24
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
