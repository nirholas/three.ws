# Fix missing plugin manifest 404s

## Symptom

```
GET https://ai-agent-plugins.vercel.app/cow-swap.json         404
GET https://ai-agent-plugins.vercel.app/contract-scanner.json 404
GET https://ai-agent-plugins.vercel.app/dao-treasury.json     404
GET https://ai-agent-plugins.vercel.app/SEO.json              404
GET https://ai-agent-plugins.vercel.app/StockData.json        404
```

## Cause

The plugin registry references manifest JSON files that are not deployed at `https://ai-agent-plugins.vercel.app/`.

## Task

1. Locate the plugin registry / list (search for `cow-swap`, `contract-scanner`, `ai-agent-plugins.vercel.app`).
2. Decide per plugin:
   - **Keep** — write the manifest JSON, deploy it to the `ai-agent-plugins` site, verify 200 from the URL above.
   - **Remove** — drop the entry from the registry so the client never tries to fetch it.
3. Wrap the manifest fetch loop so a single 404 logs at `warn` and does not break the rest of the registry load.
4. Optional: cache the registry's verified-good list server-side so the client only sees plugins whose manifests actually exist.

## Acceptance

- No 404s for plugin manifests on a fresh load of `https://three.ws/chat`.
- If a manifest is later removed upstream, the rest of the registry still loads cleanly.
