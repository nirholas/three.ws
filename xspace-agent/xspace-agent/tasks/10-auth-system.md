# Task 10: Authentication System

## Context
The admin panel and API endpoints need authentication. Currently `ADMIN_API_KEY` exists as an env var but isn't consistently enforced.

## Requirements

### API Key Authentication
- Every API route (except `/health`, `/ready`, `/config`, and static files) requires authentication
- Auth via `Authorization: Bearer <api_key>` header
- Or via `X-API-Key: <api_key>` header (for tools that don't support Bearer)
- Or via `?api_key=<key>` query param (for webhooks, with deprecation warning in logs)
- API key is set via `ADMIN_API_KEY` env var
- If `ADMIN_API_KEY` is not set, log a startup warning but allow unauthenticated access (dev mode)

### Auth Middleware
```typescript
function requireAuth(req, res, next) {
  const key = extractApiKey(req) // checks header, query param
  if (!process.env.ADMIN_API_KEY) {
    // Dev mode: no auth required, but add warning header
    res.setHeader('X-Auth-Warning', 'No ADMIN_API_KEY configured')
    return next()
  }
  if (!key) {
    return res.status(401).json({ error: { code: 'AUTH_REQUIRED', message: 'API key required', hint: 'Set the Authorization header: Bearer <your-api-key>' } })
  }
  if (!timingSafeEqual(key, process.env.ADMIN_API_KEY)) {
    return res.status(401).json({ error: { code: 'AUTH_INVALID', message: 'Invalid API key' } })
  }
  next()
}
```

### Admin Panel Login
- If `ADMIN_API_KEY` is configured, show a login screen before the admin panel
- Simple form: one input for API key + "Sign In" button
- Store the key in `sessionStorage` (cleared on tab close)
- All admin panel fetch calls include the key in the Authorization header
- Add a "Sign Out" button to the admin header
- If the key expires or is wrong, redirect back to login with a message

### Socket.IO Auth
- Socket.IO connections should also authenticate
- Send API key in the handshake `auth` object: `io('/space', { auth: { token: apiKey } })`
- Reject unauthenticated socket connections when `ADMIN_API_KEY` is set
- The live chat page (index.html) should work without auth (it's public-facing)
- Admin-only socket namespaces (`/admin`) require auth

### CORS
- Configure CORS to allow:
  - Same-origin (always)
  - Origins from `CORS_ORIGINS` env var (comma-separated list)
  - In dev mode: `localhost:*`
- Block all other origins with a clear error message

### Security Headers
- Use `helmet` middleware with sensible defaults
- Set `Content-Security-Policy` that allows:
  - Self for scripts, styles, images
  - Google Fonts for font loading
  - WebSocket connections to self
  - Inline styles (needed for dynamic theming)
- Set `X-Content-Type-Options: nosniff`
- Set `X-Frame-Options: DENY`
- Set `Referrer-Policy: strict-origin-when-cross-origin`

### Do NOT implement
- User accounts / registration / database
- OAuth / social login
- Role-based access control
- Session management beyond sessionStorage

This is a single-user tool. One API key protects everything. Keep it simple.

## Files to Create
- `src/server/middleware/auth.ts`
- `src/server/middleware/cors.ts`
- `src/server/middleware/security.ts`
- `public/login.html` — admin login page

## Files to Modify
- `src/server/index.ts` — wire up auth middleware
- `public/admin.html` — add auth check on load
- `public/js/admin.js` — include API key in all fetch/socket calls

## Acceptance Criteria
- [ ] API returns 401 when `ADMIN_API_KEY` is set and no key provided
- [ ] API works without auth when `ADMIN_API_KEY` is not set (dev mode)
- [ ] Admin panel shows login screen when auth is required
- [ ] Login persists across admin panel page navigation (sessionStorage)
- [ ] Sign out clears session and redirects to login
- [ ] Socket.IO connections authenticate correctly
- [ ] CORS blocks unauthorized origins
- [ ] Security headers present on every response
- [ ] Timing-safe comparison used for API key (no timing attacks)
- [ ] Live chat (index.html) works without authentication


