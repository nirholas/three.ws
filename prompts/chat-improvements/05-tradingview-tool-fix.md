# Task: Verify and fix the TradingViewChart client tool

## Context

A `TradingViewChart` tool was added to `chat/src/tools.js` in the `defaultToolSchema` array (it's the first entry in the `Client-side` group). It renders a TradingView widget inside an iframe using `contentType: 'text/html'`.

The tool `body` is a template literal that builds HTML and returns `{ contentType: 'text/html', content: html }`. The body is stored as a **string** in `clientDefinition.body` and later `eval()`'d client-side when the tool is called.

## The problem to verify

The tool body contains escaped `<\/script>` tags (backslash-escaped closing script tags inside a template literal). This is necessary to avoid breaking the outer JS string, but the escaping needs to be correct for the actual eval context.

The body string in `tools.js` currently looks like:
```js
body: `const symbol = args.symbol || 'BINANCE:BTCUSDT';
...
<script src="https://s3.tradingview.com/tv.js"><\\/script>
...
<\\/script>
...`
```

When this string is stored and then `eval()`'d, the `<\\/script>` in the source becomes `<\/script>` at runtime, which in an `srcdoc` iframe renders correctly as `</script>`. **Verify this chain is correct.**

## How client tools are executed

Find where `clientDefinition.body` is eval'd. Search `chat/src/` for `eval` or `new Function` or `clientDefinition`. The execution likely happens in `App.svelte` or a dedicated tool runner. Read that code to understand:
1. How `args` is passed in
2. Whether it's `eval()` or `new Function('args', body)(args)`
3. Whether async/await is supported (the `Choice` tool uses `await choose(...)`)

## What to check and fix

1. **Read the tool executor** — find where body strings are run and confirm the call signature matches what the TradingViewChart body expects (`args.symbol`, `args.interval`, `args.theme`).

2. **Verify the escape chain** — trace what the body string looks like at each stage:
   - As written in `tools.js` (raw source)
   - After JS parses the template literal (what's in memory)
   - After `eval()` runs it (what gets returned)
   - What `srcdoc` receives

3. **Fix if broken** — if the `<\/script>` escaping is wrong, correct it. The goal is for the `srcdoc` iframe to receive valid HTML with proper `</script>` tags.

4. **Verify the return shape** — the executor likely checks `toolresponse.content.contentType`. Confirm the body returns `{ contentType: 'text/html', content: html }` in the shape the executor and `Toolcall.svelte` expect.

   In `Toolcall.svelte` (line 30–52), when `toolresponse.content.contentType === 'text/html'`, it sets `displayType = 'webpage'` and renders `displayedContent` via `srcdoc`. The `displayedContent` is set from `toolresponse.content.content` when a `content` field is present (line 39). Confirm our tool returns exactly this.

5. **Test the full path** — if you can run the dev server (`cd chat && npm run dev`), open the chat, enable the TradingViewChart tool, and ask the model to show a BTC chart. Confirm the iframe renders. If you can't run the dev server, add a note about what to manually test.

## Success criteria

1. The escape chain for `</script>` tags is correct — no double-escaping or under-escaping
2. The return shape `{ contentType: 'text/html', content: html }` is confirmed to match what `Toolcall.svelte` expects
3. `cd chat && npx vite build` passes
4. If runnable: enabling the tool and asking for a chart produces a rendered TradingView widget

## House rules

- Primary file to edit: `chat/src/tools.js`
- Read `chat/src/Toolcall.svelte` and the tool executor before making changes
- Do not change `Toolcall.svelte` unless there is a clear bug in how it handles the `text/html` content type
- Report: what was verified correct, what was fixed, what was skipped, unrelated bugs noticed
