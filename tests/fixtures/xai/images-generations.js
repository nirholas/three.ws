// xAI image generation response bodies, copied verbatim from docs.x.ai on
// 2026-11-20. Do not edit the strings: they are what the docs publish, so a
// parser that reads them reads what the API documents.
//
// REST_RESPONSE_EXAMPLE
//   Source: https://docs.x.ai/developers/rest-api-reference/inference/images.md
//   ("POST /v1/images/generations", "Response example")
//
// DEFERRED_DONE_EXAMPLE
//   Source: https://docs.x.ai/developers/model-capabilities/images/generation.md
//   ("Deferred generation", step 2, the 200 poll answer). `"usage": {...}` is
//   elided in the docs, so the trailing usage object is filled from the field
//   list in the REST reference above (cost_in_usd_ticks is required there).
//
// Live error bodies observed with curl against POST /v1/images/generations on
// 2026-11-20 (no key / a malformed key), kept with their HTTP status.

export const REST_RESPONSE_EXAMPLE = `{
  "data": [
    {
      "url": "..."
    },
    {
      "url": "..."
    }
  ]
}`;

export const DEFERRED_DONE_EXAMPLE_PREFIX = `{"request_id": "...", "status": "done", "data": [{"url": "...", "mime_type": "image/jpeg"}]`;

export const LIVE_NO_CREDENTIALS = {
	status: 401,
	body: '{"code":"unauthenticated:no-credentials","error":"No credentials presented."}',
};

export const LIVE_INCORRECT_KEY = {
	status: 400,
	body: '{"code":"invalid-argument","error":"Incorrect API key provided. You can obtain an API key from https://console.x.ai."}',
};
