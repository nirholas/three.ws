---
mode: agent
description: "Fix broken template literals in validator lightbox"
---

# Fix Validator Lightbox Template Strings

## Problem

In `src/validator.js`, the `showLightbox()` method uses Mustache-style `{{` double-braces instead of JavaScript template literal `${` syntax:

```js
<link rel="stylesheet" href="{{location.protocol}}//{{location.host}}/style.css">
```

This renders as literal text `{{location.protocol}}//{{location.host}}/style.css` instead of resolving to the actual URL like `https://3dagent.vercel.app/style.css`.

## Fix

1. In `src/validator.js`, find the `showLightbox()` method
2. Replace `{{location.protocol}}` with `${location.protocol}`
3. Replace `{{location.host}}` with `${location.host}`
4. Ensure the surrounding string uses backticks (template literal) — it already does

## Validation

- Open a glTF model, run validation, click the lightbox/report button
- The new tab should load with proper CSS styling from the current host
- Check the rendered HTML source to confirm the URL resolved correctly
