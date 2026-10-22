# SAO Portal for Render (free plan). LibreOffice is included so final approvals can be made into PDFs.
FROM node:24-bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update \
 && apt-get install -y --no-install-recommends libreoffice-writer-nogui fonts-liberation fonts-dejavu-core fonts-crosextra-carlito fonts-crosextra-caladea \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY . .

ENV NODE_ENV=production \
    SAO_SECURE_COOKIES=1 \
    HOME=/tmp
EXPOSE 10000
CMD ["node", "start-cloud.js"]
