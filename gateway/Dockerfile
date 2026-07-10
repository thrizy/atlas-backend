FROM node:20-slim
WORKDIR /app

COPY package.json ./
RUN npm install

COPY tsconfig.json ./
COPY src ./src

ENV PORT=8080
EXPOSE 8080

# Run TypeScript directly via tsx (small service; no separate build step).
CMD ["npx", "tsx", "src/server.ts"]
