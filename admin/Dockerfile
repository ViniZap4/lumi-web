# lumi-admin: o painel de administração do servidor (SvelteKit + adapter-node).
#   docker build --build-arg LUMI_ADMIN_ORIGIN=https://lumi-admin.<tailnet>.ts.net -t lumi-admin .
# Imagens fixadas por versão exata, como as do porvia (web/Dockerfile).

FROM node:26.12.1-alpine3.24 AS build
WORKDIR /src
COPY package.json package-lock.json .npmrc ./
RUN npm ci --no-audit --no-fund
# O Kit fixa a origem no build (a proteção de formulários compara com o Origin do
# navegador): uma imagem atende um endereço.
ARG LUMI_ADMIN_ORIGIN=http://localhost:3000
COPY . .
RUN ORIGIN="$LUMI_ADMIN_ORIGIN" npm run build

FROM gcr.io/distroless/nodejs26-debian13:nonroot
WORKDIR /app
COPY --from=build /src/build ./build
COPY --from=build /src/package.json ./package.json
ENV NODE_ENV=production PORT=3000 HOST=0.0.0.0
EXPOSE 3000
# Sem shell nem wget na distroless: o healthcheck usa o próprio node.
HEALTHCHECK --interval=15s --timeout=5s --retries=5 --start-period=10s \
  CMD ["/nodejs/bin/node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
CMD ["build/index.js"]
