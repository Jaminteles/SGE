# Imagem da interface (UI-091).
#
# Duas etapas: a primeira compila com o Node, a segunda publica só o resultado
# num nginx. A imagem final não leva `node_modules` nem código-fonte — o que vai
# para produção é o que o navegador baixa, e nada além.

FROM node:22-alpine AS build
WORKDIR /app

# `npm ci` antes de copiar o código: a camada das dependências só é refeita
# quando o `package-lock.json` muda.
COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build:prod

FROM nginx:1.27-alpine AS runtime

# `browser/` é a pasta que o construtor do Angular gera com os arquivos servidos.
COPY --from=build /app/dist/frontend-ng/browser /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Sem root e sem porta privilegiada: por isso 8080, e não 80.
USER nginx
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/ >/dev/null || exit 1
