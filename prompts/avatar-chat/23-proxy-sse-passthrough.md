# 23 — Proxy server: pass SSE streaming headers to browser

## Status
Critical gap — the provider now sends `stream: true` to Anthropic. The proxy at `/api/llm/anthropic` must forward the SSE stream to the browser with correct headers. If it buffers the full response, streaming is silently broken (the response works but arrives all at once, no `brain:stream` events until completion).

## File
`api/llm/anthropic.js` (or wherever the proxy route lives — check the server directory)

## What to verify

Find the proxy handler. It likely does something like:
```js
const resp = await fetch('https://api.anthropic.com/v1/messages', { ... body });
const data = await resp.json();
return res.json(data);
```

This buffers everything — **must be replaced** with a streaming passthrough.

## Fix

```js
export default async function handler(req, res) {
    const body = await readRequestBody(req); // parse POST body
    body.stream = true; // ensure streaming is on

    const upstream = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            'x-api-key': process.env.ANTHROPIC_API_KEY,
            'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(body),
    });

    if (!upstream.ok) {
        const text = await upstream.text();
        return res.status(upstream.status).send(text);
    }

    // Forward SSE headers
    res.setHeader('content-type', 'text/event-stream');
    res.setHeader('cache-control', 'no-cache');
    res.setHeader('connection', 'keep-alive');
    res.setHeader('transfer-encoding', 'chunked');

    // Pipe the stream
    const reader = upstream.body.getReader();
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(value);
    }
    res.end();
}
```

Adapt to whatever server framework is used (Express, Vercel edge, Hono, etc.). The key is: **no buffering**, **pipe the raw SSE chunks directly**.

## Verification
Open DevTools → Network. Send a message. Find the `/api/llm/anthropic` request. In the Response tab, you should see `text/event-stream` content type and multiple `data:` lines arriving incrementally. If you see a single response payload arriving all at once, the proxy is still buffering.
