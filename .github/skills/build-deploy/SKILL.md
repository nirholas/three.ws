---
name: build-deploy
description: "Build, deploy, and configure the 3D viewer app. Use when: running dev server, building for production, deploying to Vercel, configuring CORS, editing vercel.json routes, managing static assets, or troubleshooting build issues."
argument-hint: "Describe the build or deploy task"
---

# Build & Deploy

## When to Use

- Starting development server or troubleshooting it
- Building for production
- Deploying to Vercel
- Configuring CORS, routes, or caching
- Managing static assets in `public/`
- Fixing build errors or dependency issues

## Commands

| Command | Purpose |
|---------|---------|
| `npm install` | Install dependencies |
| `npm run dev` | Vite dev server on port 3000 |
| `npm run build` | Production build → `dist/` |
| `npm run clean` | Remove `dist/` contents |
| `npm run deploy` | Build + `vercel --prod` with local config |
| `npm version <patch\|minor\|major>` | Bump version, auto-pushes via `postversion` |

## Vite Configuration

- Entry: `index.html` (default Vite behavior)
- Static assets: `public/` folder copied to build output
- No custom `vite.config.js` — uses Vite defaults with `staticFiles` in package.json

## Vercel Deployment

**Config**: `vercel.json`

Key routes:
- `/assets/*` — Cached 1 week (`max-age=604800`)
- `/.well-known/*` — Cached 1 day, serves from `public/.well-known/`
- `/robots.txt`, `/sitemap.xml` — Served from `public/`
- `/avatars/*` — Served from `public/avatars/`

**Domain**: [3dagent.vercel.app](https://3dagent.vercel.app/)

## CORS Configuration

**Config**: `cors.json`

Allowed origins:
- `https://3dagent.vercel.app` and subdomains
- `http://localhost:*` / `https://localhost:*`
- Specific partner domains

## Static Assets

```
public/
├── avatars/     → Default 3D model files (GLB)
├── .well-known/ → Domain verification files
├── robots.txt   → Search engine directives
└── sitemap.xml  → Site map
```

## Procedure

### Local Development
1. `npm install`
2. `npm run dev`
3. Open `http://localhost:3000`

### Production Deploy
1. `npm run build` — verify no build errors
2. `npm run deploy` — builds and deploys to Vercel
3. Verify at [3dagent.vercel.app](https://3dagent.vercel.app/)

### Adding Static Assets
1. Place files in `public/` (copied as-is to build output)
2. If they need caching rules, add a route in `vercel.json`
3. If they need CORS access, verify origins in `cors.json`

## Troubleshooting

- **Port 3000 in use**: Kill existing process or edit `package.json` dev script port
- **Build fails on Three.js imports**: Check `three` version in `package.json` matches CDN paths in `viewer.js`
- **CORS errors**: Check `cors.json` for allowed origins
- **Assets 404 after deploy**: Verify route patterns in `vercel.json`
