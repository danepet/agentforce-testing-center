# Use Node.js LTS version
FROM node:18-alpine

# Install build dependencies for SQLite3
RUN apk add --no-cache python3 make g++ sqlite

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies and rebuild SQLite3 for Alpine
RUN npm ci --omit=dev --ignore-scripts && \
    npm rebuild sqlite3

# Copy application code
COPY . .

# Create necessary directories
RUN mkdir -p data uploads

# Initialize database
RUN npm run init-db

# Expose port
EXPOSE 3000

# Set production environment
ENV NODE_ENV=production

# Start the application
CMD ["npm", "start"]