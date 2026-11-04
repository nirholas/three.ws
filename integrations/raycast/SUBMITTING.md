# Publishing to the Raycast Store

Store review is a pull request to <https://github.com/raycast/extensions> (docs: <https://developers.raycast.com/basics/publish-an-extension>, checked 2026-11-04).

## State

| Check | Result (2026-11-04) |
| --- | --- |
| `npm test` | 5 tests pass, replaying real production responses |
| `npx tsc --noEmit` | clean |
| `npm run build` | `ready - built extension successfully` |
| `npm run lint` | passes ESLint and Prettier and icon checks; one error remains: `Invalid author "three_ws"` (404 from raycast.com/api/v1/users/three_ws) |

## Owner steps

1. Create a Raycast account for three.ws at <https://www.raycast.com> and note its username.
2. Set `"author"` in `package.json` to that username, then `npm run lint` must report no error.
3. Add 3 to 6 screenshots (Raycast Window Capture, `Cmd+Shift+Opt+M`, 2000x1250 PNG) of the form, the generating view and the result into a `metadata/` folder.
4. Run `npm run publish`. It forks `raycast/extensions`, copies this folder to `extensions/three-ws` and opens the pull request.
5. Answer review comments. Raycast reviewers ask for a CHANGELOG.md on later versions.

Order 938 (`prompts/finish/938-partners-15-listings-prs-and-sends.md`) owns sending the pull request.
