# Publishing to the Raycast Store

Store review is a pull request to <https://github.com/raycast/extensions> (docs: <https://developers.raycast.com/basics/publish-an-extension>, checked 2026-11-04). A merged extension gets its own page on raycast.com/store and is installable from the Raycast command bar.

## State

| Check | Result (2026-11-28) |
| --- | --- |
| Commands | Forge a 3D Model, Search 3D Assets, Search My Models |
| `npm test` | 16 tests pass, replaying real production responses (Forge, catalog, My Models) |
| `npx tsc --noEmit` | clean |
| `npm run build` | `ready - built extension successfully` |
| `npm run lint` | ESLint, Prettier and icon checks pass; one error remains: `Invalid author "three_ws"` (404 from raycast.com/api/v1/users/three_ws; `threews`, `three-ws` and `nirholas` are also unclaimed) |
| `CHANGELOG.md` | present, with the `{PR_MERGE_DATE}` placeholder Raycast fills on merge |
| `npm run check:integrations -- raycast` | `ok` |

The commands have not been exercised inside Raycast itself: Raycast runs only on macOS and Windows, and this package was built on Linux. Step 3 below is that check.

## Owner steps

1. Create a Raycast account for three.ws at <https://www.raycast.com> (sign in with the GitHub account that will open the pull request) and note its username.
2. Set `"author"` in `package.json` to that username, then `npm run lint` must report no error.
3. On a Mac: `npm install && npm run dev`. Run each command once with a real API key: forge a draft, search "wooden chair" and copy its embed code, open Search My Models.
4. While each command is open, take screenshots with Raycast's Window Capture (`Cmd+Shift+Opt+M`, saved as 2000x1250 PNG) into a `metadata/` folder in this directory. Good set (3 to 6): the asset search with a detail pane, the snippet view, the Forge result, My Models with previews.
5. Run `npm run publish`. It forks `raycast/extensions`, copies this folder to `extensions/three-ws` and opens the pull request.
6. Answer review comments. Later versions add a new section to `CHANGELOG.md`.

Order 938 (`prompts/awaiting-owner/938-partners-15-listings-prs-and-sends.md`) owns sending the pull request.
