# three.ws Forge for Supabase

Insert a prompt into a Postgres table and get a textured 3D model back in Supabase Storage.
No 3D pipeline to run and no GPU to rent: a Supabase Edge Function sends the prompt to
[three.ws Forge](https://three.ws/forge), waits for the model, and stores the GLB in a private
bucket. Your app follows each model's progress over Realtime.

```js
const { data: model } = await supabase
	.from('three_ws_models')
	.insert({ prompt: 'a brass telescope on a wooden tripod' })
	.select()
	.single();
// A minute or two later: model.status === 'done', the GLB is in three-ws-models/<user id>/<id>.glb
```

The integration's source lives in
[`integrations/supabase/`](https://github.com/nirholas/three.ws/tree/main/integrations/supabase).
It is three files you add to your Supabase project: two SQL migrations and one Edge Function.

## What you get

- **A `three_ws_models` table.** A signed-in user inserts `prompt` (3 to 600 characters) and
  optionally `tier` (`draft`, `standard` or `high`). Everything else is written by the Edge
  Function: `status`, `forge_job_id`, `storage_path`, `preview_image_url`, `error_code`, `error`.
- **Row level security.** Users see and delete only their own rows and may write only `prompt`
  and `tier`. Status and URLs cannot be forged from the client.
- **A private `three-ws-models` bucket.** Finished models are stored at
  `<user id>/<row id>.glb`. A user can read only their own folder, through signed URLs or the
  Storage API.
- **Realtime progress.** The table is in the `supabase_realtime` publication, so a client sees
  each status change as it happens.
- **A per-user cap.** One user can have at most 3 unfinished models at a time, so nobody can
  spend your three.ws quota by queueing a thousand rows. Change the cap by replacing
  `three_ws_max_active_per_user()`.
- **Reliable delivery.** The Edge Function runs right after each insert and every minute while
  any model is unfinished. Busy lanes and rate limits are retried at the time three.ws asks for.
  Each submission carries the row id as its `Idempotency-Key`, so a retry never pays for a second
  generation.

## How it works

```
 your app                 Postgres                       Edge Function            three.ws
 ────────                 ────────                       ─────────────            ────────
 insert {prompt} ───────▶ three_ws_models (queued)
                          after-insert trigger ─pg_net─▶ three-ws-forge
                                                         claim row (submitting)
                                                         POST /api/forge ───────▶ start job
                          (generating) ◀──────────────── record job id
                          pg_cron, every minute ─pg_net▶ poll GET /api/forge?job ▶ done + glb_url
                                                         download GLB
                          (storing → done) ◀──────────── upload to three-ws-models
 Realtime UPDATE ◀─────── row change
 createSignedUrl ───────▶ Storage
```

Status moves `queued → submitting → generating → storing → done`, or to `failed` with an
`error_code` and a readable `error`. While a model waits for a retry, its `error_code` and
`error` say why (for example `provider_busy`), and `next_attempt_at` says when.

## Set it up

You need a Supabase project, the [Supabase CLI](https://supabase.com/docs/guides/local-development/cli/getting-started),
and a free three.ws account.

### 1. Get a three.ws API key

Sign in at [three.ws](https://three.ws) and create a key at
[three.ws/dashboard/api-keys](https://three.ws/dashboard/api-keys). A free account is enough:
the default image-to-3D pipeline is free.

### 2. Add the files to your project

From your project root (the folder that holds `supabase/`):

```bash
npx degit nirholas/three.ws/integrations/supabase/supabase/migrations supabase/migrations --force
npx degit nirholas/three.ws/integrations/supabase/supabase/functions/three-ws-forge supabase/functions/three-ws-forge
```

`--force` only lets degit write into a folder that already exists; it adds the two
`*_three_ws_models*.sql` files beside your own migrations and overwrites nothing else.

No CLI project yet? Run `supabase init` first, or paste the two SQL files into the SQL editor
in order and deploy the function from the dashboard.

### 3. Apply the migrations

```bash
supabase link --project-ref <your-project-ref>
supabase db push
```

This creates the table, its policies, the bucket, and the trigger and cron job that call the
function. The schedule migration enables `pg_net` and `pg_cron`, which every Supabase project
can do.

### 4. Set the secrets and deploy the function

Pick a long random string for the shared secret the database uses to call the function:

```bash
FORGE_SECRET=$(openssl rand -hex 32)
supabase secrets set THREE_WS_API_KEY=<your three.ws key> THREE_WS_FORGE_SECRET=$FORGE_SECRET
supabase functions deploy three-ws-forge --no-verify-jwt
```

`--no-verify-jwt` is needed because the caller is your own database, not a signed-in user. The
function refuses every request that does not carry `THREE_WS_FORGE_SECRET`.

### 5. Tell the database where the function is

In the SQL editor, store the project URL and the same secret in Vault:

```sql
select vault.create_secret('https://<your-project-ref>.supabase.co', 'three_ws_project_url');
select vault.create_secret('<the FORGE_SECRET value>', 'three_ws_forge_secret');
```

Until both secrets exist, inserts still succeed and the database logs a warning that the
sweep cannot run.

### 6. Check it

Insert a row as a user (or with the service role, which stores the model under `service/`),
then run one sweep and read the summary:

```bash
curl -X POST "https://<your-project-ref>.supabase.co/functions/v1/three-ws-forge?wait=1" \
  -H "x-three-ws-forge-secret: $FORGE_SECRET"
# {"claimed":1,"submitted":1,"polled":0,"stored":0,"failed":0,"retried":0}
```

Function logs (Dashboard, Edge Functions, three-ws-forge, Logs) show one JSON line per step:
`submit`, `retry`, `stored`, `failed`.

## Use it from your app

Insert a prompt, follow it over Realtime, and show the model when it is done. This uses
[`<agent-3d>`](web-component.md), the three.ws viewer, which renders any GLB URL with no key:

```html
<script type="module" src="https://three.ws/agent-3d/latest/agent-3d.js"></script>
<agent-3d id="viewer" style="width:100%;height:480px"></agent-3d>

<script type="module">
	import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
	const supabase = createClient('https://<ref>.supabase.co', '<publishable key>');

	const { data: model, error } = await supabase
		.from('three_ws_models')
		.insert({ prompt: 'a brass telescope on a wooden tripod', tier: 'standard' })
		.select()
		.single();
	if (error) throw error; // e.g. "You already have 3 models generating..."

	supabase
		.channel(`model-${model.id}`)
		.on(
			'postgres_changes',
			{ event: 'UPDATE', schema: 'public', table: 'three_ws_models', filter: `id=eq.${model.id}` },
			async ({ new: row }) => {
				if (row.status === 'failed') return console.error(row.error);
				if (row.status !== 'done') return console.log(row.status);
				const { data } = await supabase.storage.from('three-ws-models').createSignedUrl(row.storage_path, 3600);
				document.getElementById('viewer').setAttribute('body', data.signedUrl);
			},
		)
		.subscribe();
</script>
```

A complete page (sign-in, prompt form, live list of models, viewer, download) is in
[`integrations/supabase/example/index.html`](https://github.com/nirholas/three.ws/blob/main/integrations/supabase/example/index.html).

From a server, insert with the service role key. Those rows have no `user_id` and their models
are stored under `service/`.

## Tiers and limits

- `draft` is the fastest, `standard` (the default) balances speed and detail, and `high` takes
  longest. All three run on the free image-to-3D pipeline.
- A model usually takes one to three minutes. A row still unfinished after 45 minutes is failed
  with `error_code = 'timeout'`.
- Generations count against the three.ws account that owns `THREE_WS_API_KEY`. When its daily
  limit is reached, rows wait (`error_code = 'rate_limited'`) and resume when the limit resets.
- The bucket accepts GLB files up to 50 MB, the Supabase free plan's upload limit.

## Errors

- `sign_in_required`: the API key is missing, revoked or expired. Create a new one at
  [three.ws/dashboard/api-keys](https://three.ws/dashboard/api-keys) and run
  `supabase secrets set THREE_WS_API_KEY=...`.
- `invalid_prompt`: the prompt is too short or was refused. Describe one subject.
- `generation_failed`: three.ws could not make a model from this prompt, even after retries.
  Rephrase it as one concrete object.
- `invalid_glb`: the downloaded file was not a GLB. Insert the prompt again.
- `timeout`: the model was not ready within 45 minutes.
- `sweep_error` on an unfinished row: a database or Storage write failed; the next sweep resumes
  the row from the step it reached. The `error` column has the Storage or database message.

## Remove it

```sql
select cron.unschedule('three-ws-forge-sweep');
drop table public.three_ws_models cascade;
drop function public.three_ws_kick_sweep, public.three_ws_claim_models, public.three_ws_next_due_seconds,
	public.three_ws_max_active_per_user, public.three_ws_models_touch, public.three_ws_models_guard_insert,
	public.three_ws_models_after_insert;
```

Then empty and delete the `three-ws-models` bucket in the dashboard and run
`supabase functions delete three-ws-forge`.

## Support

Open an issue at [github.com/nirholas/three.ws](https://github.com/nirholas/three.ws/issues). The
integration is tested on every change: its migrations run on Postgres 18 with Supabase's roles,
`auth.uid()` and Storage policies, and a live test generates a real model through production
three.ws (`integrations/supabase/README.md`).
