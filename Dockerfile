# Use Node.js LTS version
FROM node:18-alpine

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies (without postinstall script)
RUN npm ci --omit=dev --ignore-scripts

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