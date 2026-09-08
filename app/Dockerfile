# CALIBR app — Fly.io image. Node 24 (node:sqlite works flag-free; libsql prebuilt needs glibc, so slim/Debian not Alpine).
FROM node:24-slim

WORKDIR /app

# Install deps first (better layer caching). optionalDependencies (libsql) install by default.
COPY package*.json ./
RUN npm install --omit=dev

# App source
COPY . .

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

CMD ["node", "server.js"]
