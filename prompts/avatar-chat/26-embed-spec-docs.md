# 26 — Document avatar-chat attribute in EMBED_SPEC.md

## Status
Gap — `avatar-chat="off"` is a new public attribute of `<agent-3d>` and must be documented in `specs/EMBED_SPEC.md` alongside the other boolean/string attributes.

## File
`specs/EMBED_SPEC.md`

## What to find

Locate the attribute table — it should have rows for `responsive`, `kiosk`, `name-plate`, `background`, etc. Find the section (around the `responsive` row based on the current file) and add:

| Attribute | Type | Default | Description |
|---|---|---|---|
| `avatar-chat` | `"off"` or absent | on | Set to `"off"` to disable the inline avatar layout, thought bubble, and walk animation. Restores the original bottom-bar chat layout. |

Also add a brief prose section explaining the feature:

```markdown
## Avatar-in-Chat Mode

By default, `<agent-3d>` uses a vertical chat layout where the 3D avatar is visible as a conversation participant through a transparent window between the message history and the input bar. While the LLM generates a response, the avatar:

- **Walks** in place (synchronized to token streaming)
- **Displays a thought bubble** above its head showing the streaming text
- **Returns to idle** when the response is complete

To disable this behavior and restore the original side-by-side bottom-bar layout:

```html
<agent-3d avatar-chat="off" src="..."></agent-3d>
```

The `avatar-chat="off"` attribute is CSS-driven and can be toggled at runtime via JavaScript:
```js
element.setAttribute('avatar-chat', 'off');   // disable
element.removeAttribute('avatar-chat');        // re-enable
```
```

## Verification
The EMBED_SPEC.md attribute table includes the `avatar-chat` row. The prose section explains the feature and the `"off"` toggle.
