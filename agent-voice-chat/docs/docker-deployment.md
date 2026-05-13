# Prompt: Docker & Deployment

## Problem
Puppeteer requires Chrome/Chromium, system-level audio dependencies, and specific flags. Setting up the environment manually is error-prone, especially on different hosting providers. Docker standardizes this.

## Goal
Containerized deployment with Docker that handles all Puppeteer dependencies, plus deployment configs for common platforms.

## Dockerfile

```dockerfile
FROM node:20-slim

# Install Chromium dependencies + audio tools
RUN apt-get update && apt-get install -y \
    chromium \
    ffmpeg \
    fonts-liberation \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libgbm1 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libx11-xcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    libxshmfence1 \
    xvfb \
    pulseaudio \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# Set up virtual display and audio
ENV DISPLAY=:99
ENV PULSE_SERVER=unix:/tmp/pulse/native

WORKDIR /app

# Install dependencies first (cache layer)
COPY package.json package-lock.json ./
RUN npm ci --production

# Copy application code
COPY . .

# Ensure no sensitive files
RUN rm -f x-spaces/.cookies.json .env

# Tell Puppeteer to use installed Chromium
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

EXPOSE 3000

# Start with virtual display
CMD ["sh", "-c", "Xvfb :99 -screen 0 1280x720x24 & node server.js"]
```

## docker-compose.yml

```yaml
version: '3.8'

services:
  agent:
    build: .
    ports:
      - "3000:3000"
    env_file:
      - .env
    volumes:
      - cookies:/app/x-spaces/.cookies.json   # Persist login cookies
      - conversations:/app/conversations       # Persist conversation history
    restart: unless-stopped
    deploy:
      resources:
        limits:
          memory: 2G        # Puppeteer is memory-hungry
          cpus: '2.0'
        reservations:
          memory: 512M

volumes:
  cookies:
  conversations:
```

## .dockerignore
```
node_modules
.env
.env.*
!.env.example
.git
docs
x-spaces/.cookies.json
*.md
```

## Platform-Specific Deployment Guides

### Railway
```toml
# railway.toml
[build]
builder = "dockerfile"

[deploy]
healthcheckPath = "/health"
healthcheckTimeout = 300
restartPolicyType = "on_failure"
```
- Set env vars in Railway dashboard
- Railway supports Dockerfiles natively
- Note: Railway's free tier may not have enough RAM for Puppeteer

### Render
```yaml
# render.yaml
services:
  - type: web
    name: x-space-agent
    env: docker
    dockerfilePath: ./Dockerfile
    plan: standard  # Need at least standard for Puppeteer
    healthCheckPath: /health
    envVars:
      - key: NODE_ENV
        value: production
```

### DigitalOcean App Platform
- Use Dockerfile deployment
- Minimum: Basic plan with 1GB RAM
- Set env vars in app settings

### VPS (Generic)
```bash
# On any Ubuntu/Debian VPS
git clone <repo-url>
cd x-space-agent
cp .env.example .env
# Edit .env with your keys
docker compose up -d

# View logs
docker compose logs -f

# Update
git pull
docker compose up -d --build
```

## Health Check Endpoint
Add to server.js:
```js
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    xSpacesStatus: xSpaces?.getStatus() || 'not-initialized',
    timestamp: new Date().toISOString()
  })
})
```

## Environment Variable Management

### Production Checklist
```env
# Required
OPENAI_API_KEY=           # Or GROQ_API_KEY or ANTHROPIC_API_KEY
AI_PROVIDER=openai-chat   # Provider selection

# X Auth (at least one method)
X_AUTH_TOKEN=             # Preferred: cookie-based auth
X_CT0=                    # CSRF token for cookie auth
# OR
X_USERNAME=               # Form-based login
X_PASSWORD=
X_EMAIL=                  # For verification step

# Optional
PORT=3000
ADMIN_TOKEN=              # Admin panel authentication
ELEVENLABS_API_KEY=       # For premium TTS
NODE_ENV=production
```

## Puppeteer in Docker — Known Issues & Solutions

**Issue: Chromium crashes with "No usable sandbox"**
Solution: Already handled by `--no-sandbox` flag in browser.js

**Issue: Audio doesn't work in headless mode**
Solution: Xvfb provides a virtual display; Puppeteer's `--use-fake-device-for-media-stream` handles fake audio devices

**Issue: High memory usage**
Solution: Set `--disable-dev-shm-usage` flag (already in browser.js), use `--single-process` in constrained environments

**Issue: Container runs out of /dev/shm space**
Solution: In docker-compose, add:
```yaml
shm_size: '1gb'
```

## Implementation Steps
1. Create Dockerfile with all Chromium/audio dependencies
2. Create docker-compose.yml with volumes and resource limits
3. Add .dockerignore
4. Add /health endpoint to server.js
5. Test local Docker build and run
6. Create platform-specific deployment configs
7. Document deployment process in README

## Validation
- [ ] `docker build .` succeeds
- [ ] `docker compose up` starts server on port 3000
- [ ] Admin panel is accessible at localhost:3000/admin
- [ ] Bot can start and log into X from Docker container
- [ ] Bot can join a Space and speak from Docker
- [ ] Cookie persistence works across container restarts
- [ ] /health endpoint responds correctly
- [ ] Memory stays under 2GB during normal operation


