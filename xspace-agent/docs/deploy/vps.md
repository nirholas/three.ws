# Deploy to VPS (Ubuntu/Debian)

## Prerequisites

- Docker and Docker Compose installed
- At least 2 CPU cores and 2GB RAM (4 CPU / 4GB recommended)
- ~3GB disk space (app + Chromium)

## Quick Start

```bash
git clone https://github.com/youruser/xspace-agent.git
cd xspace-agent
cp .env.example .env
# Edit .env with your credentials
nano .env

# Start the agent
docker compose up -d
```

The agent is now running at `http://your-ip:3000`.

## With Monitoring (Prometheus + Grafana)

```bash
docker compose --profile with-monitoring up -d
```

- Grafana: `http://your-ip:3001` (default login: admin/admin)
- Prometheus: `http://your-ip:9090`

## With Redis (Multi-Instance State)

```bash
docker compose --profile with-redis up -d
```

## Common Operations

### View logs
```bash
docker compose logs -f agent
```

### Update to latest version
```bash
git pull
docker compose build
docker compose up -d
```

### Restart the agent
```bash
docker compose restart agent
```

### Stop everything
```bash
docker compose down
```

### Stop and remove volumes (full reset)
```bash
docker compose down -v
```

## Security Recommendations

- Run behind a reverse proxy (nginx/Caddy) with TLS
- Set `ADMIN_API_KEY` to a strong secret
- Restrict port 3000 to localhost if using a reverse proxy:
  ```yaml
  # In docker-compose.yml, change:
  ports:
    - "127.0.0.1:3000:3000"
  ```
- Keep Docker and the host OS updated

## Resource Requirements

| Component | CPU | RAM | Disk |
|-----------|-----|-----|------|
| Agent + Chromium | 2 cores | 2-4GB | 3GB |
| Redis (optional) | 0.5 cores | 256MB | 100MB |
| Prometheus (optional) | 0.5 cores | 512MB | 1GB/week |
| Grafana (optional) | 0.5 cores | 256MB | 100MB |


