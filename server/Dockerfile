# Loop service — zero runtime dependencies, so the image is tiny and portable.
# Works on Railway, Render, Fly, Cloud Run, or any container host.
FROM node:20-alpine

WORKDIR /app

# No dependencies to install (built-in http + fetch only). Copy source and go.
COPY package.json ./
COPY src ./src

ENV NODE_ENV=production
# Hosts inject PORT; the app reads it (defaults to 8790 locally).
EXPOSE 8790

# Basic healthcheck against the built-in endpoint.
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s \
  CMD wget -qO- http://localhost:${PORT:-8790}/api/health || exit 1

CMD ["node", "src/http/server.js"]
