# insta360 08: resumable R2 multipart upload API for capture files up to 8 GiB

How to run: paste this file's repo path into a fresh Claude Code chat in this repository and say "run this work order". Independent of every other `insta360-` order, so it can run in parallel with all of them. Dev port: 3338.

## Operating clause (binding)

- Read CLAUDE.md, then [_context/insta360-00-CONTEXT.md](_context/insta360-00-CONTEXT.md) (contract C4 `capture-upload` rows are yours; the browser uploader belongs to order 340). CLAUDE.md overrides both.
- Finish 100% in this session. Never end with a question, an option list or an unexecuted plan; judgment calls go in one line of the report.
- The only stops are the CLAUDE.md gates. Batch every owner step (push, deploy, any R2 bucket CORS change you cannot make with the existing credentials) into ONE message at the end.
- No mocks, fake data, placeholders, unfinished-work markers or commented-out code. No em-dash or en-dash characters. Bug fixes are test-first.
- Load the `engineering-standards` skill before building. Stage explicit paths, commit promptly, and run `npm run check:rules -- --paths <files>` (exit 0) before each commit.

## Why this matters

A 5-minute 8K `.insv` is several gigabytes. [api/scene-upload.js](../../api/scene-upload.js) caps at 512 MB with a single presigned PUT; one dropped connection loses the whole upload. S3-compatible multipart upload on R2 lets the browser send parts in parallel and resume after a failure, with the bytes going straight to R2, never through Cloud Run.

## Step 0: re-derive the current state

    sed -n 1,200p api/scene-upload.js
    grep -rln "S3Client\|@aws-sdk/client-s3\|R2_" api/_lib | head
    grep -n "R2_" api/_lib/env.js | head -20
    grep -n "\"@aws-sdk" package.json
    grep -rn "CreateMultipartUpload\|UploadPart" api src --include=*.js | head

Record the R2 client helper, bucket names, public URL base and any existing multipart code.

## Tasks

1. **Endpoints** per contract C4: `api/capture-upload/create.js`, `sign.js`, `complete.js`, `abort.js` (or one file with an action router, whichever matches how the server discovers nested api routes; check step 0 and `server/index.mjs`). Reuse the existing R2 client helper; add no new credentials. `requireCreator` on all four. CORS via `api/_lib/http.js`.
2. **Create**: validate filename, extension and content type per the contract table (sniffing is the worker's job; here, the allow-list), `size_bytes` up to 8 GiB, compute `part_size` (minimum 8 MiB, scale up so `part_count` stays at or below 1000) and start the multipart upload with key `captures/raw/<user_id>/<uuid>/<sanitised filename>`. Store `{ upload_id, key, user_id, size_bytes, created_at }` server-side (database table if a sibling upload flow uses one, otherwise an HMAC-signed token returned to the client carrying those fields, signed with an existing server secret) so `sign`, `complete` and `abort` can verify the caller owns that upload.
3. **Sign**: presigned `UploadPart` URLs for up to 100 part numbers per call, 1-hour expiry, ownership checked.
4. **Complete**: `CompleteMultipartUpload` with the client's part list; verify the resulting object size equals `size_bytes` via `HeadObject`; return `source_url` as an https URL the workers can fetch (a presigned `GetObject` URL valid 7 days, or the public base if the bucket path is public; follow what scene-upload returns).
5. **Abort** and **cleanup**: abort on request; add an R2 lifecycle rule (or a cron in `vercel.json` with its handler, hot file, anchored edit, last, if the repo's R2 credentials cannot set lifecycle rules) that aborts incomplete multipart uploads older than 24 hours and deletes `captures/raw/` objects older than 30 days.
6. **Bucket CORS**: the browser must read the `ETag` response header of each part PUT. Check the bucket's CORS (`ExposeHeaders: ETag`, allowed origins for production and localhost dev ports) with the existing credentials and fix it if you can; if the token lacks permission, put the exact change in the owner message.
7. **Rate limits**: per-user concurrent open uploads (at most 3) and a daily byte quota through the existing `limits` helpers; designed error messages.
8. **Tests** `tests/capture-upload.test.js`: validation matrix, part-size math (1 KB, 512 MB, 8 GiB), ownership checks across users, token tamper rejection, complete with a wrong size, abort. **Live proof**: a Node script in `scripts/` (not the root) that uploads a real 2 GB or larger 360 video through the four endpoints against the real R2 bucket, kills the process mid-upload, resumes by re-signing only the missing parts (`ListParts`), completes, downloads the object back and compares SHA-256. Record throughput and the resume evidence. Delete the test object after.
9. Docs: API reference entries, a short section in the capture docs, changelog entry (developer-facing).

## Definition of done

- [ ] Four endpoints implement contract C4 exactly; tests pass.
- [ ] Live 2 GB or larger upload with an interrupted and resumed run, byte-identical round trip, numbers recorded.
- [ ] Bucket CORS exposes `ETag` (or the exact change is in the owner message), incomplete uploads are cleaned up.
- [ ] `npm test` and `npm run audit:docs` pass.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| R2 credentials missing locally | `self-unblock-playbook` skill credentials row (Cloud Run env or Secret Manager). |
| R2 token cannot change CORS or lifecycle | Cron fallback for cleanup; CORS change goes in the owner message with the exact JSON. |
| No large real 360 video at hand | Use a real fixture from `gs://three-ws-capture-fixtures/insta360/` or a CC-licensed 8K equirect video from Wikimedia Commons; concatenating copies of a real video to reach the size is fine for a transport test. |

## Close out (required)

1. Verify every Definition of done line with the command output in front of you.
2. Commit with explicit paths and a `type(scope): ...` subject that describes the diff.
3. All lines pass: `git mv` this file to `prompts/archive/` in its own closing commit and repoint inbound links. If an owner step is last: leave the file, put a dated status line under the title naming what remains, and add it to the owner message. Either way append to [_context/insta360-PROGRESS.md](_context/insta360-PROGRESS.md) with the measured throughput.
4. Report: what step 0 measured; files and SHAs; evidence per Definition of done line; the measured numbers; the one batched owner message; one-line judgment calls. No trailing questions.
