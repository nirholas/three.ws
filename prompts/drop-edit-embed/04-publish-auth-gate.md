# Task 04 — Auth-gate + preserve edits across login redirect

## Why this exists

After task 03, signed-out users who click Publish see a "Sign in" modal. If they click it, they go to `/login`, sign in, and are dumped back at the app root — their edits are gone. That's a conversion killer. This task preserves the session across the login round-trip so the publish resumes automatically.

## Shared context

- Login page is [public/login.html](../../public/login.html). It reads `?next=<url>` and redirects to it on success. Verify by reading the file — do not assume.
- Session cookie is set by `/api/auth/login` ([api/auth/login.js](../../api/auth/login.js)) via `createSession` / `sessionCookie` from [api/\_lib/auth.js](../../api/_lib/auth.js). The browser will have a valid cookie after login completes.
- The Editor session state that needs to survive the round-trip:
    - The loaded source (URL or the dropped file bytes)
    - `session.materialEdits`, `session.transformEdits`, `session.visibilityEdits` from [src/editor/session.js](../../src/editor/session.js)
- File bytes can't go in the URL. Dropped files are the hard case — browsers won't let us re-drop a file after navigation. We store dropped bytes in `IndexedDB` keyed by a short random id; URL-loaded models are re-fetched by URL after login.
- Edits are small JSON — they can round-trip in `sessionStorage`.

## What to build

### 1. Edit persistence helper

Create `src/editor/edit-persistence.js`. Two responsibilities:

```js
/**
 * Stash current editor state so the user can continue after a round-trip (login).
 * Returns a short token to be placed in the URL (e.g. ?resume=abc123).
 */
export async function stashSession(session) { … }

/**
 * Restore previously stashed state. Returns:
 *   { source: { url } | { file: File }, edits: { materialEdits, transformEdits, visibilityEdits } }
 * or null if no valid stash.
 */
export async function restoreSession(token) { … }

/** Delete the stash (after successful resume). */
export async function clearStash(token) { … }
```

Implementation:

- Stash id: `'edt_' + crypto.getRandomValues(new Uint8Array(6)) → base64url`.
- JSON blob (edits + source-url if URL-loaded) → `sessionStorage.setItem('edt:' + id, JSON.stringify(blob))`.
- If the source is a `File`, put the bytes in `IndexedDB` under db `3dagent`, store `edt-bytes`, key = id, value = `{ name, type, bytes: ArrayBuffer }`.
- TTL: best-effort only. Overwrite prior stashes for the same session (`sessionStorage`), so cap is effectively 1.
- On restore, if either the metadata or the bytes are missing, return `null` (don't throw).

### 2. Hook stash on "Sign in to publish"

In `src/editor/publish-modal.js` (task 03), `showAuthRequired()` currently redirects to `/login?next=<current URL>`. Replace with:

```js
import { stashSession } from './edit-persistence.js';

async showAuthRequired() {
	const token = await stashSession(this._session);   // pass session in via constructor
	const nextURL = new URL(location.href);
	nextURL.searchParams.set('resume', token);
	nextURL.searchParams.set('publish', '1');          // auto-open publish after resume
	location.href = `/login?next=${encodeURIComponent(nextURL.toString())}`;
}
```

The `PublishModal` needs the `session` reference — update its constructor / the call site in `src/editor/index.js` to pass it.

### 3. Hook resume on boot

In [src/app.js](../../src/app.js), after the Editor is constructed and attached, read `location.search` for `resume=`:

```js
const resumeToken = new URLSearchParams(location.search).get('resume');
if (resumeToken) {
	const stashed = await restoreSession(resumeToken);
	if (stashed) {
		if (stashed.source.url) await this.view(stashed.source.url, '', new Map());
		else if (stashed.source.file)
			await this.load(new Map([[stashed.source.file.name, stashed.source.file]]));
		// Replay edits into the new session.
		this.editor.session.restoreEdits(stashed.edits);
		// Auto-open Publish if &publish=1.
		if (new URLSearchParams(location.search).get('publish') === '1') {
			this.editor._openPublishModal();
		}
		await clearStash(resumeToken);
		// Strip the query params so reloads don't loop.
		const clean = new URL(location.href);
		clean.searchParams.delete('resume');
		clean.searchParams.delete('publish');
		history.replaceState(null, '', clean.toString());
	}
}
```

Add `EditorSession.restoreEdits({ materialEdits, transformEdits, visibilityEdits })` in [src/editor/session.js](../../src/editor/session.js) — assigns the three maps, then emits `onChange` so the GUI re-renders via `materialEditor.rebuild()` etc. (The individual rebuilds are already called by `onContentChanged`; call `session.onChange` last to trigger the editor's internal re-read of labels.)

### 4. Anonymous-publish alternative (deferred)

For this task, **do not** build anonymous publish. The Widget Studio already requires auth, and we want to match that behavior. Note in your reporting block that this choice was intentional so a future task can reverse it if needed.

## Files you own

- Create: `src/editor/edit-persistence.js`
- Edit: [src/editor/session.js](../../src/editor/session.js) — add `restoreEdits(...)`.
- Edit: `src/editor/publish-modal.js` (from task 03) — swap `showAuthRequired()` to stash+redirect.
- Edit: [src/app.js](../../src/app.js) — resume-on-boot block after editor attach.

## Files off-limits

- `src/editor/publish.js` — stable after task 02.
- `src/editor/index.js` — you may change the modal call site to pass `session`, but nothing else.
- Any `api/*` file — login already redirects by `?next=`.
- `public/login.html` — verify it uses `?next=`; do not modify it.

## Acceptance

- Load `http://localhost:3000`, drop a GLB, change a material color, click Publish → you're signed out → you land on `/login?next=<url with resume + publish>`.
- Sign in → you land back at `/`, the same model loads, your material edit is re-applied (verify by opening the Material Editor — the color still reflects your change), the Publish modal auto-opens and runs the full flow.
- Reloading the page after the resume does NOT re-trigger the resume (the query params have been stripped).
- Refreshing mid-login (before signing in) and going back to `/` still works — no orphan state.

## Reporting

Use the template in [00-README.md](./00-README.md). Mention both URL-loaded and file-dropped paths were tested.
