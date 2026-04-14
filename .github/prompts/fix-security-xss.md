---
mode: agent
description: "Fix XSS vulnerability in glTF validator — unescaped title field"
---

# Fix XSS: Validator Title Escaping

## Problem

In `src/validator.js`, the `setResponse()` method escapes `extras.author`, `extras.license`, and `extras.source` using `escapeHTML()`, but `extras.title` is assigned raw:

```js
if (extras.title) {
    this.report.info.extras.title = extras.title; // ← NOT escaped
}
```

A malicious glTF file can set `asset.extras.title` to `<img src=x onerror=alert(1)>` and execute arbitrary JavaScript when the validation report renders via `dangerouslySetInnerHTML` in `src/components/validator-report.jsx`.

## Fix

1. In `src/validator.js`, find the `setResponse()` method
2. Change `extras.title` assignment to: `this.report.info.extras.title = escapeHTML(extras.title);`
3. Verify `escapeHTML()` is already defined at the bottom of the file (it is)
4. Check `src/components/validator-report.jsx` — confirm `dangerouslySetInnerHTML` is used for rendering. If possible, switch to safe text rendering instead

## Validation

- Load a glTF file with `asset.extras.title` set to `<script>alert('xss')</script>` — should render as escaped text, not execute
- All other validator report fields should still render correctly
