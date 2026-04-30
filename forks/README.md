# forks/

Sibling clones of the three reference repos we're pulling patterns from. Cloned here (not vendored into the main tree) so we can read, copy, and diff without polluting `three.ws` build output or repo history.

This directory is git-ignored — clones live locally only.

## Manifest

| Repo                                                                              | License | Why                                                                       | Use these files                            |
| --------------------------------------------------------------------------------- | ------- | ------------------------------------------------------------------------- | ------------------------------------------ |
| [met4citizen/TalkingHead](https://github.com/met4citizen/TalkingHead)             | MIT     | Best-in-class browser lipsync + MotionEngine (LLM tool-call abstraction). | `modules/talkinghead.mjs`, `modules/lipsync-*.mjs` |
| [SerifeusStudio/threlte-mcp](https://github.com/SerifeusStudio/threlte-mcp)       | MIT     | Reference MCP schema for exposing a three.js scene as agent tools.        | `src/tools/*.ts`, `src/server.ts`          |
| [tegnike/aituber-kit](https://github.com/tegnike/aituber-kit)                     | MIT     | Emotion-tag protocol + production lipsync/TTS pipeline.                   | `src/features/messages/`, `src/features/lipSync/` |

Skipped intentionally:

- `dexvdev/svelte-vrm-live` — AGPL-3.0, viral copyleft. Read on GitHub only.
- `pixiv/ChatVRM` — archived 2025-05.
- `OpenReplicant/ProtoReplicant` — abandoned 2023.

## Clone

```sh
./clone.sh
```

Re-runnable; `git pull`s any clones already present.

## Workflow

1. `./clone.sh` to populate.
2. Read the relevant files in each clone.
3. Lift snippets into `chat/src/` or `api/` — re-license correctly (all three are MIT, attribute in the file header).
4. Never edit inside `forks/` and try to merge upstream. These are read-only references.
