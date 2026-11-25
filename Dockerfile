# Optional: lets a host such as Render run the REAL shop (Node API + compiled COBOL).
FROM node:22-bookworm-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends gnucobol \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY . .
# Fails the build on a COBOL compile error, so a broken program never goes live.
RUN node scripts/build-cobol.js
ENV NODE_ENV=production
EXPOSE 4173
CMD ["node", "server.js"]
