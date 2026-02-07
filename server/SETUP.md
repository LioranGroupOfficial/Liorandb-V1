# LioranDB Server - Setup & Deployment Guide

This guide covers installation, configuration, and deployment of LioranDB Server.

## Table of Contents

1. [System Requirements](#system-requirements)
2. [Installation](#installation)
3. [Configuration](#configuration)
4. [Running the Server](#running-the-server)
5. [Docker Deployment](#docker-deployment)
6. [Production Setup](#production-setup)
7. [Monitoring & Logs](#monitoring--logs)
8. [Troubleshooting](#troubleshooting)

## System Requirements

### Minimum Requirements
- Node.js 16.x or higher
- npm 8.x or yarn 1.22.x
- 512MB RAM
- 100MB disk space

### Recommended Requirements
- Node.js 18.x or 20.x
- 2GB RAM
- SSD storage
- Linux or macOS for production

## Installation

### Option 1: Global Installation (Recommended)

Install directly from npm:

```bash
npm i -g @liorandb/db
```

This provides:
- `ldb-serve` - Start the database server
- `ldb-cli` - Command-line interface for database management

Verify installation:
```bash
npm ldb-serve --help
ldb-cli --help
```

### Option 2: Local Installation from Repository

#### Step 1: Clone Repository

```bash
git clone https://github.com/LioranGroupOfficial/Liorandb.git
cd server
```

#### Step 2: Install Dependencies

Using npm:
```bash
npm install
```

Using yarn:
```bash
yarn install
```

#### Step 3: Verify Installation

```bash
npm run build
```

## Configuration

### Environment Variables

Create a `.env` file in the server root (optional):

```bash
NODE_ENV=development
PORT=4000
LOG_LEVEL=info
```

### Database Configuration

Database configuration is managed in `src/config/database.ts`. By default:
- Data is stored in the local file system
- Each database is isolated in its own directory
- No additional setup required

## Running the Server

### Global Installation

```bash
ldb-serve
```

Or with npx:
```bash
npx ldb-serve
```

The server will:
- Start on `http://localhost:4000`
- Be accessible from all network interfaces
- Display all available host addresses

### Local Development Mode

With hot reload:
```bash
npm run dev
```

The server will:
- Start on `http://localhost:4000`
- Auto-restart on file changes
- Display all network interfaces available

### Local Production Mode

Build and run:
```bash
npm run build
npm start
```

## Docker Deployment

### Using Docker

Create a `Dockerfile`:

```dockerfile
FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY dist ./dist

EXPOSE 4000

CMD ["node", "dist/server.js"]
```

Build the image:
```bash
docker build -t liorandb-server .
```

Run the container:
```bash
docker run -d \
  -p 4000:4000 \
  -v liorandb-data:/app/data \
  --name liorandb-server \
  liorandb-server
```

### Docker Compose

Create `docker-compose.yml`:

```yaml
version: '3.8'

services:
  liorandb-server:
    build: .
    ports:
      - "4000:4000"
    volumes:
      - liorandb-data:/app/data
    environment:
      NODE_ENV: production
      PORT: 4000
    restart: unless-stopped

volumes:
  liorandb-data:
```

Start with Docker Compose:
```bash
docker-compose up -d
```

## Production Setup

### 1. Use Process Manager (PM2)

Install PM2:
```bash
npm install -g pm2
```

Create `ecosystem.config.js`:

```javascript
module.exports = {
  apps: [
    {
      name: 'liorandb-server',
      script: './dist/server.js',
      instances: 'max',
      exec_mode: 'cluster',
      env: {
        NODE_ENV: 'production',
        PORT: 4000,
      },
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      error_file: './logs/err.log',
      out_file: './logs/out.log',
      max_memory_restart: '1G',
    },
  ],
};
```

Start the server:
```bash
pm2 start ecosystem.config.js
pm2 save
pm2 startup
```

### 2. Nginx Reverse Proxy

Configure Nginx (`/etc/nginx/sites-available/liorandb`):

```nginx
upstream liorandb {
    server localhost:4000;
}

server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://liorandb;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Enable the site:
```bash
sudo ln -s /etc/nginx/sites-available/liorandb /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
```

### 3. SSL/TLS with Let's Encrypt

```bash
sudo apt-get install certbot python3-certbot-nginx
sudo certbot --nginx -d your-domain.com
```

Update Nginx config to redirect HTTP to HTTPS:

```nginx
server {
    listen 80;
    server_name your-domain.com;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name your-domain.com;
    
    ssl_certificate /etc/letsencrypt/live/your-domain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/your-domain.com/privkey.pem;
    
    # ... rest of configuration
}
```

## Monitoring & Logs

### View Logs

Development:
```bash
# Logs appear in terminal
npm run dev
```

Production (PM2):
```bash
pm2 logs liorandb-server
pm2 monit
```

### Health Check

```bash
curl http://localhost:4000/health
```

Expected response:
```json
{
  "ok": true,
  "time": "2026-02-08T10:20:30.000Z"
}
```

### Monitor Resource Usage

With PM2:
```bash
pm2 monit
```

With system tools:
```bash
# CPU and memory usage
top | grep node

# Specific process
ps aux | grep node
```

## Backup & Data Management

### Backup Data

```bash
# Backup entire data directory
tar -czf liorandb-backup-$(date +%Y%m%d).tar.gz /path/to/liorandb/data
```

### Restore Data

```bash
tar -xzf liorandb-backup-20260208.tar.gz -C /path/to/liorandb/
```

## Troubleshooting

### Port 4000 Already in Use

Find and stop the process:
```bash
# Find process using port 4000
lsof -i :4000

# Kill the process
kill -9 <PID>
```

Or use a different port:
```bash
PORT=4001 npm start
```

### Connection Refused

1. Verify server is running:
```bash
curl http://localhost:4000/health
```

2. Check firewall:
```bash
# On Linux
sudo ufw allow 4000

# On macOS
sudo ipfw add allow tcp from any to any 4000
```

3. Check network binding:
```bash
netstat -tlnp | grep 4000
```

### High Memory Usage

1. Check for memory leaks:
```bash
node --expose-gc dist/server.js
```

2. Limit memory with PM2:
```bash
pm2 start dist/server.js --max-memory-restart 1G
```

### Authentication Issues

1. Clear JWT tokens if needed - they're stateless
2. Verify user account exists
3. Check token expiration
4. Ensure Bearer token format: `Authorization: Bearer <token>`

### Database Connection Errors

1. Verify database exists:
```bash
curl -X GET http://localhost:4000/databases \
  -H "Authorization: Bearer <token>"
```

2. Check file system permissions
3. Verify disk space availability

## Performance Optimization

### Enable Clustering

```bash
NODE_ENV=production npm start
```

Or use PM2 with cluster mode (see ecosystem.config.js above).

### Connection Pooling

By default, Express handles connections efficiently. For high traffic:
- Use Nginx as reverse proxy
- Configure PM2 cluster mode
- Monitor memory usage

### Caching

Implement caching in your application layer using reverse proxy or middleware.

## Installing Updates

### Global Installation Updates

Update to the latest version:
```bash
npm i -g @liorandb/db@latest
```

Check current version:
```bash
ldb-serve --version
```

### Local Installation Updates

```bash
npm update
npm audit
npm audit fix
```

## Security Checklist

- [ ] Change default admin password
- [ ] Enable HTTPS/SSL
- [ ] Use environment variables for secrets
- [ ] Enable firewall
- [ ] Regular backups
- [ ] Monitor logs for suspicious activity
- [ ] Keep dependencies updated
- [ ] Use strong JWT secrets (if configurable)
- [ ] Restrict database access
- [ ] Enable request logging

## Maintenance

### Update Dependencies

```bash
npm update
npm audit
npm audit fix
```

### Check for Vulnerabilities

```bash
npm audit
```

### Regular Backups

Set up automated backups:
```bash
# Add to crontab
0 2 * * * tar -czf /backups/liorandb-$(date +\%Y\%m\%d).tar.gz /app/data
```

---

For API documentation, see [API.md](./API.md)
For overview, see [README.md](./README.md)
