# microsoft 36: pick photos from OneDrive and SharePoint for Forge, and save finished models back to OneDrive

How to run: paste this file's repo path into a fresh Claude Code chat in this repository and say "run this work order". Independent of every other `microsoft-` order, so it can run in parallel with all of them. Dev port: 3136.

## Operating clause (binding)

- Read CLAUDE.md, then [_context/microsoft-00-CONTEXT.md](_context/microsoft-00-CONTEXT.md) (facts, approved wording, parallel-run rules). CLAUDE.md overrides both.
- Finish 100% in this session. Never end with a question, an option list or an unexecuted plan; judgment calls go in one line of the report.
- The only stops are the CLAUDE.md gates. Batch every owner step (Partner Center, store submission, Entra registration, push, deploy) into ONE message at the end. Never contact Microsoft or any third party.
- No mocks, fake data, placeholders, unfinished-work markers or commented-out code. No em-dash or en-dash characters. Bug fixes are test-first.
- Load the `engineering-standards` skill before building. Stage explicit paths, commit promptly, and run `npm run check:rules -- --paths <files>` (exit 0) before each commit.

## Why this matters

Product photos inside companies live in OneDrive and SharePoint, not on the desktop. Today a Forge user has to download a photo, then upload it. The Microsoft File Picker (v8) lets a user browse their OneDrive (personal or work) and SharePoint libraries inside three.ws, and Microsoft Graph lets three.ws save the finished GLB, poster and PowerPoint export straight back. It is a concrete, daily-use reason for Microsoft 365 customers to stay in three.ws.

## Step 0: re-derive the current state

    grep -rn -i "onedrive\|graph.microsoft.com\|msal" src api --include=*.js | head
    grep -n "MS_ENTRA_SSO_CLIENT_ID\|scope" api/_lib/microsoft-marketplace.js api/auth/*microsoft* 2>/dev/null | head
    ls src | grep -i -E "forge-upload|forge-photo|upload" ; grep -n "input type=\"file\"\|type: 'file'" pages/forge*.html src/forge*.js | head
    grep -n "@azure/msal-browser" package.json

Read Microsoft's current File Picker v8 docs (postMessage protocol, consumer versus work account endpoints, required token audiences) and the Graph upload docs (simple upload under 4 MB, upload sessions above). Find the Forge photo input path and the export menu (GLB, poster, PowerPoint from order 802 if present).

## Tasks

1. **Client auth.** MSAL Browser (bundled via npm, not a CDN) with the SPA redirect on the existing multitenant Entra app (`MS_ENTRA_SSO_CLIENT_ID`), delegated `Files.ReadWrite` (or the narrowest scopes that work) requested only when the user clicks the OneDrive action, never at sign-in. Works for personal Microsoft accounts and work accounts. The feature is hidden when the client id is not configured, determined from a server config endpoint, not a build flag.
2. **Pick from OneDrive.** A "From OneDrive or SharePoint" option next to the Forge photo upload opens File Picker v8, filters to image types, downloads the chosen file through Graph, and hands it to the existing upload path (same validation, size limits and photo prep). Multi-select where Forge supports multiple views.
3. **Save to OneDrive.** "Save to OneDrive" in the model's export or download menu uploads the GLB (and poster and PPTX when available) to a user-chosen folder (picker in folder mode) using upload sessions for large files, with real progress from the upload session ranges, and a success toast linking to the file.
4. **States.** Loading, cancel, consent declined, token expired (silent refresh then interactive), Graph throttling (honor `Retry-After`), quota full, and offline, each with an actionable message. Hover, active and focus states; keyboard operable; 400px layout.
5. **Tests.** Unit tests for the picker message protocol handler, the upload session chunker and error mapping, test-first for any bug. A browser check of the full flow on the dev server with a real Microsoft account if one is available through the QA path; otherwise the picker launch, the protocol handshake and the Graph calls against the live endpoint returning its documented auth error.
6. **Docs.** `docs/onedrive.md` (user steps, scopes requested and why, admin consent notes), the redirect URI and scope in the owner message and in the Entra resource list if `integrations/microsoft/provisioning/resources.json` exists. Changelog entry, `npm run build:pages`.

## Definition of done

- [ ] The OneDrive action appears only when configured, and the full pick and save flow runs on the dev server (screenshot paths), or the documented live auth error is shown where no account is available.
- [ ] Upload session chunking is verified for a file over 4 MB (test output).
- [ ] No console errors; `npm test` and `npm run audit:docs` pass; docs and changelog landed.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| No Microsoft test account | Verify against the live endpoints up to the auth boundary and list the redirect URI and test steps in the owner message. |
| `MS_ENTRA_SSO_CLIENT_ID` unset in production | Expected; the feature hides itself until set. |
| Picker docs differ for consumer accounts | Implement both base URLs as Microsoft documents and pick by account type from the MSAL account. |

## Close out (required)

1. Verify every Definition of done line with the command output in front of you.
2. Commit with explicit paths and a `type(scope): ...` subject that describes the diff.
3. All lines pass: `git mv` this file to `prompts/archive/` in its own closing commit and repoint inbound links. If an owner step is last: leave the file, put a dated status line under the title naming what remains, and add it to the owner message. Either way append to [_context/microsoft-PROGRESS.md](_context/microsoft-PROGRESS.md).
4. Report: what step 0 measured; files and SHAs; evidence per Definition of done line; the one batched owner message; one-line judgment calls. No trailing questions.
