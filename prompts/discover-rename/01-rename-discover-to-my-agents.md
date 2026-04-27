---
name: Rename /discover → /my-agents
depends_on: none
---

# Goal

Move the personal "On-chain Agents in your linked wallets" page from `/discover` to `/my-agents`. The page content/data flow stays identical — only the URL, page title, nav label, and a few copy strings change.

# Success criteria

1. Visiting `/my-agents` renders the page that `/discover` used to render.
2. Visiting `/discover` returns a **301** to `/my-agents` (server-side redirect via `vercel.json`, not client JS).
3. The nav link in `index.html` (`#discoverLink`) labels the link **"My Agents"** and points to `/my-agents`.
4. The page `<title>` is "My Agents · three.ws".
5. Page heading stays "On-chain Agents" (this is accurate — it describes the content), but the **subtitle** becomes "Agents owned by your linked wallets" (drops the word "discover").
6. Empty-state copy: "No wallets linked / Link a wallet to see your on-chain agents." (replaces "discover your on-chain agents").
7. Every other reference to `/discover` in the repo is either updated to `/my-agents` OR is the redirect rule itself.

# Steps

1. **Move files** (use `git mv` to preserve history):

    - `public/discover/index.html` → `public/my-agents/index.html`
    - `public/discover/discover.js` → `public/my-agents/my-agents.js`
    - `public/discover/discover.css` → `public/my-agents/my-agents.css`
    - Update internal `<link>` / `<script>` paths in the HTML accordingly.
    - **Do NOT rename the CSS class prefix `discover-*`** in this task — that's a separate cleanup. Renaming classes risks breaking the JS selector logic and isn't required to ship the URL change. Note the leftover prefix in a follow-up TODO comment at the top of `my-agents.css`.

2. **Update page chrome** in `public/my-agents/index.html`:

    - `<title>On-chain Agents · three.ws</title>` → `<title>My Agents · three.ws</title>`
    - `<meta name="description">` → "Your ERC-8004 agents across every supported chain."
    - Update subtitle and (downstream) any empty-state strings emitted by `my-agents.js`.

3. **Update empty-state copy** in `public/my-agents/my-agents.js`:

    - Find the "Link a wallet to discover your on-chain agents." string and change to "Link a wallet to see your on-chain agents."
    - Find the "No wallets linked" block — keep heading, update sub-copy.

4. **Update nav link** in `index.html` (look for `#discoverLink`, around lines 243–249):

    - `href="/discover"` → `href="/my-agents"`
    - Visible label "Discover" → "My Agents"
    - Keep the auth-gated visibility logic untouched.

5. **Add 301 redirect** in `vercel.json`:

    ```json
    {
    	"source": "/discover",
    	"destination": "/my-agents",
    	"permanent": true
    }
    ```

    Add to the `redirects` array (create the array if missing). Verify the rewrite for the new path works — check existing patterns in `vercel.json` to see if `/my-agents` needs an explicit rewrite rule for the static directory or if Vercel's default behavior covers it.

6. **Grep the repo** for remaining references and update each:

    ```
    rg -n '/discover\b' --hidden -g '!node_modules' -g '!dist' -g '!dist-*'
    ```

    Likely hits to update: `README.md`, `docs/**`, `sitemap.xml` (if present), service worker file (search for `discover` in `public/sw.js` or similar), other prompt files. **Don't** update `prompts/` historical files — those are records.

7. **Bump service worker cache version** if the SW caches `/discover/index.html`. Find the SW version constant and increment.

# Verification

- `curl -I https://localhost:port/discover` → `301` with `Location: /my-agents`.
- `/my-agents` renders the same page as before, including empty state for a no-wallet user.
- Click the nav link from the home page — lands on `/my-agents` with no console errors.
- Hard-refresh with SW active — old `/discover` HTML is not served.

# Out of scope

- Renaming `discover-*` CSS classes (note as TODO).
- Any data/API change. `/api/erc8004/hydrate` stays as-is.
- Adding new content to the page (handled in task 03).
