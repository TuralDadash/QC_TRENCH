FROM node:20-alpine AS base
WORKDIR /app
# tesseract + traineddata for overlay OCR; vips for sharp's native bindings;
# python3 + pip for the Gemini analysis script (util/analyze_image.py).
RUN apk add --no-cache \
    tesseract-ocr \
    tesseract-ocr-data-eng \
    tesseract-ocr-data-deu \
    vips-dev \
    build-base \
    python3 \
    py3-pip

# Gemini analysis deps go in a venv under /opt — outside /app so the dev
# bind-mounts in docker-compose.yml don't shadow it. The /api/process route
# finds this interpreter via the PYTHON_BIN env var.
COPY util/requirements.txt /tmp/requirements.txt
RUN python3 -m venv /opt/gemini-venv \
    && /opt/gemini-venv/bin/pip install --no-cache-dir -r /tmp/requirements.txt
ENV PYTHON_BIN=/opt/gemini-venv/bin/python

FROM base AS deps
COPY package.json ./
RUN npm install --no-audit --no-fund

FROM base AS dev
ENV NODE_ENV=development
COPY package.json ./
COPY --from=deps /app/node_modules ./node_modules
COPY . .
EXPOSE 3000
CMD ["npm", "run", "dev"]
