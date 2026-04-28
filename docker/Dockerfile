# Use lightweight Node base image
FROM node:20-alpine

# Set working directory
WORKDIR /app

# Install your package globally
RUN npm install -g @liorandb/db@1.1.11

# Create data directory
RUN mkdir -p /data

# Expose default port
EXPOSE 4000

# Set environment variables
ENV PORT=4000
ENV NODE_ENV=production

# Default command
CMD ["ldb-serve", "--root", "/data"]