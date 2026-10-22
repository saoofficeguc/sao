# SAO Portal container (Hugging Face Spaces or Render, free plans). LibreOffice is included for the signed PDFs.
# The data lives in Supabase Storage (server/cloud.js); the container's own disk is only a working copy.
FROM node:24-bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update \
 && apt-get install -y --no-install-recommends libreoffice-writer-nogui fonts-liberation fonts-dejavu-core fonts-crosextra-carlito fonts-crosextra-caladea \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY . .

# Hugging Face runs the app as a normal user on port 7860, so the working data goes in /tmp.
# (Render sets its own PORT, which overrides the 7860 here.)
ENV NODE_ENV=production \
    PORT=7860 \
    SAO_DATA_DIR=/tmp/sao-data \
    SAO_SECURE_COOKIES=1 \
    HOME=/tmp
EXPOSE 7860
CMD ["node", "start-cloud.js"]
