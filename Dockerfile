FROM node:22-alpine

WORKDIR /app

# Instalar curl para healthcheck
RUN apk add --no-cache curl

# Copiar archivos de dependencias
COPY package*.json ./

# Instalar únicamente dependencias de producción
RUN npm ci --omit=dev

# Copiar código fuente
COPY . .

# Directorio de datos persistente para SQLite
RUN mkdir -p /app/data
VOLUME ["/app/data"]

# Variables de entorno por defecto
ENV NODE_ENV=production
ENV PORT=3000
ENV BASE_URL=https://urlshort.agrolara.dedyn.io
ENV ADMIN_PASSWORD=Agro1280@
ENV DATA_DIR=/app/data

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:3000/health || exit 1

CMD ["node", "server.js"]
