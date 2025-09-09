# Use Node.js LTS version
FROM node:18-slim

# Install system dependencies
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    sqlite3 \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --omit=dev && npm cache clean --force

# Copy application code
COPY . .

# Create necessary directories
RUN mkdir -p data uploads

# Initialize database
RUN npm run init-db

# Set production environment
ENV NODE_ENV=production

# Start the application
CMD ["node", "src/server.js"]