---
description: Add three.ws 3D asset rules to this project's AGENTS.md so every Grok session here finds, makes and embeds models the same way
---

# /three-ws-init

Add the three.ws project instructions to this repository.

1. Read the template at `${GROK_PLUGIN_ROOT}/templates/AGENTS.md`.
2. Look for an instructions file in the project root, in this order: `AGENTS.md`, `Agents.md`, `AGENT.md`. Use the first that exists. If none exists, create `AGENTS.md`.
3. If that file already has a heading `## 3D assets (three.ws)`, replace only that section (from the heading to the next `## ` heading or the end of the file) with the template. Otherwise append the template to the end of the file, separated by one blank line. Never change or remove anything else in the file.
4. Read the project's `package.json` (if any) and adjust one line of the inserted section to the stack you find: name the framework (React, Vue, Svelte, Next.js, plain HTML) and, if `three` or `@react-three/fiber` is a dependency, say to load GLBs with the project's existing loader rather than adding a viewer script.
5. Show the user the diff of the instructions file and say that Grok reads `AGENTS.md` at the start of every session in this project. Do not commit; leave that to the user.
