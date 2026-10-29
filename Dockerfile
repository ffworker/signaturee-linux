# Experimental test-AD CLI image; not a production web server.
FROM node:24-bookworm-slim
ENV NODE_ENV=production \
    HOME=/tmp \
    TMPDIR=/tmp
RUN apt-get update \
    && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
       libreoffice-writer fonts-liberation ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --gid 10001 signaturee \
    && useradd --uid 10001 --gid 10001 --no-create-home --shell /usr/sbin/nologin signaturee
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund \
    && npm cache clean --force
COPY src ./src
COPY scripts ./scripts
USER 10001:10001
ENTRYPOINT ["node", "/app/scripts/generate-signatures.js"]
CMD ["--help"]
