# src/desktop/os

The native operating-system layer of the three.ws desktop: a virtual file
system and the apps a real computer ships with. Everything here is real
(IndexedDB storage, `getUserMedia`, Open-Meteo, three.ws APIs); there is no
mock data.

## App contract

`registry.js` declares each app (title, size, glyph, keywords) and lazily
imports `apps/<id>.js`, which exports:

```js
export function mount(host, ctx) { /* build UI inside host */ return cleanupFn; /* optional */ }
```

`host` is an empty element that fills the window body (use class `napp` on
your root; the window already has its own title bar). `ctx`:

| Member | Meaning |
| --- | --- |
| `h(tag, cls, html)`, `esc(s)`, `icon(name, size)`, `tile(app, size, glyph)` | DOM and glyph helpers |
| `registerGlyph(name, pathBody)` | add a 24px stroke glyph (also exported by `../icons.js`) |
| `toast(msg)`, `notify({ title, body, app })` | transient toast; notification centre entry |
| `fs` | the virtual file system (`./fs.js`) |
| `arg` | launch argument (`launchId(id, { arg })`), for example a path to open |
| `onArg(fn)` | called when the app is already open and is launched again with a new `arg` |
| `setTitle(text)` | live window title, e.g. the open file name |
| `onClose(fn)` | run on window close (stop streams, timers, listeners) |
| `launchId(id, { arg })`, `openPath(path)` | open an app, or a file in the app that handles its type |
| `prefs`, `onPrefs(fn)`, `store.get/set/del` | desktop preferences and namespaced localStorage |
| `windows()`, `closeWindow(id)`, `focusWindow(id)` | the running windows (Task Manager) |
| `fetchJson(url, init)` | same-origin credentialed JSON fetch that throws on non-2xx |

Styling: each app ships `apps/<id>.css`, imported from its module, with all
selectors scoped under `.napp-<id>`. Use the desktop tokens (`--card`,
`--hover`, `--bd`, `--text`, `--text2`, `--accent`, `--bg`) so light mode,
accent colour and the Fluent, Aqua and Classic styles all work.
