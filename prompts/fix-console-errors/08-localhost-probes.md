# Make `localhost` provider probes silent when nothing is running

## Symptom

```
GET http://localhost:8081/list_directory  net::ERR_CONNECTION_REFUSED
GET http://localhost:11434/api/tags        net::ERR_CONNECTION_REFUSED
Error fetching models from provider Ollama TypeError: Failed to fetch
```

## Cause

The app probes local helper services on every load:

- `localhost:8081` — local filesystem / MCP-style helper.
- `localhost:11434` — Ollama's default port, used to enumerate local models.

When the user has not started those services (the common case), the failed fetches are logged loudly.

## Task

1. Find the provider probe code (search for `11434`, `Ollama`, `list_directory`, `localhost:8081`).
2. Gate the probes behind one of:
   - An explicit user opt-in setting (e.g. "Enable local model providers").
   - A one-shot probe at startup whose failure marks the provider unavailable for the rest of the session, instead of retrying.
3. On `ERR_CONNECTION_REFUSED` / `Failed to fetch`, log at `debug` (or not at all) — do not use `console.error`. The message should make it obvious this is expected when the local service is not running.
4. In the UI, render the local provider as "not detected" rather than "error."

## Acceptance

- A fresh load with no local services running produces no red errors for these probes.
- Users who do run Ollama / the local helper still get models discovered.
