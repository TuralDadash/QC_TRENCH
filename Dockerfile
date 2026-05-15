FROM node:20-alpine AS base
WORKDIR /app
# tesseract + traineddata for overlay OCR; vips for sharp's native bindings
RUN apk add --no-cache \
    tesseract-ocr \
    tesseract-ocr-data-eng \
    tesseract-ocr-data-deu \
    vips-dev \
    build-base \
    python3

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
