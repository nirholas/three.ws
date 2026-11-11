# markitdown: Office files and PDFs to Markdown

FastAPI service that turns **Word (.docx), PowerPoint (.pptx), Excel (.xlsx),
PDF and Outlook (.msg)** files into Markdown, so an agent can learn from them
(see [docs/agent-knowledge.md](../../docs/agent-knowledge.md)). It wraps
[Microsoft MarkItDown](https://github.com/microsoft/markitdown) (MIT), pinned
to `0.1.9` with only the `docx`, `pptx`, `xlsx`, `pdf` and `outlook` extras
installed. No audio, image-captioning, YouTube, Azure or plugin dependencies are
present in the image.

The API calls it from `api/_lib/agent-knowledge.js`
(`POST /api/agents/:id/knowledge`). Callers never reach this service directly.

## Endpoints

### `POST /convert`

| Header | Value |
|---|---|
| `Authorization` | `Bearer $API_KEY` (missing or wrong: `401`) |
| `X-File-Name` | the original file name, URL-encoded. Its extension is the claimed type. |
| `Content-Type` | the file's MIME type, or `application/octet-stream` |

The body is the raw file bytes (no multipart).

`200`:

```json
{
  "markdown": "# Northwind Field Handbook\n\n## Returns policy\n...",
  "metadata": { "kind": "pptx", "title": "Northwind 2027 roadmap", "slides": 4,
                "words": 92, "chars": 611, "truncated": false },
  "file": { "name": "roadmap.pptx", "kind": "pptx", "bytes": 31544, "sha256": "..." }
}
```

`metadata` carries `slides` for pptx, `sheets` for xlsx and `pages` for pdf.
`title` comes from the document's own properties (OOXML core title, the PDF Info
title, the email subject), falling back to the first heading.

Errors are `{ "error": "<code>", "message": "<human sentence>" }`:

| Status | `error` | Meaning |
|---|---|---|
| 400 | `missing_file_name`, `empty_file`, `invalid_file` | unreadable request or package, unsafe part names, encrypted file |
| 400 | `zip_bomb` | too many parts, too large unpacked, extreme compression ratio, or nested archive |
| 413 | `file_too_large` | over 25 MB |
| 415 | `unsupported_type` | extension is not one of the five |
| 415 | `type_mismatch` | extension, declared MIME and real contents disagree |
| 422 | `conversion_failed`, `conversion_crashed`, `conversion_timeout`, `too_complex`, `no_text` | the converter could not produce text |

### `GET /health`

Unauthenticated. Returns `{ "ok": true, "markitdown": "0.1.9", "formats": [...] }`.

## Hardening

- **Type from content, not the name.** [policy.py](./policy.py) detects the real
  format from magic bytes plus each format's required structure (the OOXML main
  part, the Outlook property streams). The extension and the declared MIME must
  both agree with it.
- **Zip-bomb guard.** OOXML packages are refused past 5000 parts, 300 MiB of
  declared uncompressed size, or a 100x ratio on any part over 1 MiB. Nested
  archives, encrypted entries and path-traversal names are refused too. Python's
  zipfile never inflates past the declared size, so the caps bound what any
  converter can decompress.
- **Isolated conversion.** [convert.py](./convert.py) runs each conversion in a
  forkserver child with an address-space cap (3 GiB), a CPU-time cap and sockets
  plus DNS disabled. The parent kills it after `CONVERT_TIMEOUT_SECONDS`.
- **Narrowest entry point.** Only the single converter for the validated
  format is called, on an in-memory stream. The `MarkItDown` class, plugins,
  magika sniffing and URI fetching are never used.
- **Bounded work.** Uploads are capped while streaming, `MAX_CONCURRENT`
  conversions run at once, Markdown is capped at 2,000,000 characters, the
  container runs as a non-root user, and nothing is written to disk.

## Environment

| Var | Default | |
|---|---|---|
| `API_KEY` | required | shared bearer secret. Production mounts `avatar-reconstruction-key`, which the API sends as `GCP_RECONSTRUCTION_KEY`. |
| `MAX_CONCURRENT` | `2` | conversions running at once |
| `CONVERT_TIMEOUT_SECONDS` | `45` | per-conversion wall clock |
| `CONVERT_MEMORY_BYTES` | 3 GiB | address-space cap per conversion child |

The API finds the service through `GCP_MARKITDOWN_URL`.

## Tests

The tests use real, self-authored documents in every format, built by
[fixtures.py](./fixtures.py): a hand-built docx and PDF, python-pptx and openpyxl
files, and an Outlook .msg written by a small Compound File writer.

```bash
python test_policy.py    # type detection, MIME checks, size cap, zip bombs
python test_convert.py   # real conversions, metadata, timeout, no network
python fixtures.py out/  # write the five sample files to out/
```

The Docker build runs both suites as a gate.

## Run locally

```bash
docker build -t three-ws-markitdown workers/markitdown
docker run --rm -p 8790:8080 -e API_KEY=dev three-ws-markitdown
curl -H 'Authorization: Bearer dev' -H 'X-File-Name: brief.pdf' \
  -H 'Content-Type: application/pdf' --data-binary @brief.pdf localhost:8790/convert
```

Then point the API at it with `GCP_MARKITDOWN_URL=http://localhost:8790`.

## Deploy

Use [cloudbuild.yaml](./cloudbuild.yaml), which builds, runs the test gate,
pushes, and deploys the `markitdown` Cloud Run service (CPU only, scale to zero,
8 GiB). After the first deploy, set the URL on the API service:

```bash
gcloud run services update three-ws-api --region us-central1 \
  --update-env-vars GCP_MARKITDOWN_URL=$(gcloud run services describe markitdown \
  --region us-central1 --format='value(status.url)')
```
