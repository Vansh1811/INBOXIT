# ── Stage 1: Install only production deps ──────────────────────────────────────
FROM node:20-alpine AS deps
WORKDIR /app

COPY package*.json ./
# npm ci is strict (uses package-lock.json) and faster than npm install
RUN npm ci --only=production

# ── Stage 2: Lean runtime image ─────────────────────────────────────────────────
FROM node:20-alpine AS runner
WORKDIR /app

# Run as non-root for security (never run node apps as root in prod)
RUN addgroup -S inboxit && adduser -S inboxit -G inboxit

# Copy only what's needed to run
COPY --from=deps /app/node_modules ./node_modules
COPY src/ ./src/
COPY index.js ./

# Give the non-root user ownership
RUN chown -R inboxit:inboxit /app
USER inboxit

# Your Express app port
EXPOSE 5000

# This boots Express + registers BullMQ workers (syncWorker.js is imported in index.js)
CMD ["node", "index.js"]