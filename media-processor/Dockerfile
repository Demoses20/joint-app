FROM node:20-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production PORT=8080
RUN apt-get update && apt-get install -y --no-install-recommends fonts-dejavu-core && rm -rf /var/lib/apt/lists/*
COPY package.json ./
RUN npm install --omit=dev
COPY server.js ./
EXPOSE 8080
CMD ["npm", "start"]
