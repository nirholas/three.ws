#!/usr/bin/env bash
# Grok finds or makes a 3D chair through three.ws, in raw HTTP: curl and jq only.
#
#   XAI_API_KEY=... THREE_WS_API_KEY=... ./run.sh                 Grok drives the three.ws studio server
#   THREE_WS_API_KEY=... ./run.sh --three-ws-only                 the three.ws REST calls Grok would make, no xAI key
#   ./run.sh --three-ws-only --catalog-only                       catalog search and render only, no key at all
#   ./run.sh "a brass desk lamp"                                  any other prop
#
# Every request is printed before it is sent (keys masked), so the shapes are
# visible. Keys are read from the environment only.

set -euo pipefail

MCP_URL="${THREE_WS_MCP_URL:-https://three.ws/api/mcp-studio}"
API="${THREE_WS_API:-https://three.ws}"
MODEL="${XAI_MODEL:-grok-4.7}"
OUT="${OUT:-model.png}"
XAI_KEY="${XAI_API_KEY:-${GROK_API_KEY:-}}"
MAX_ROUNDS=8
POLL_BUDGET_S=300

rest_only=0
catalog_only=0
words=()
for arg in "$@"; do
	case "$arg" in
		--three-ws-only) rest_only=1 ;;
		--catalog-only) catalog_only=1 ;;
		*) words+=("$arg") ;;
	esac
done
prop="${words[*]:-a low-poly wooden chair}"

for bin in curl jq; do
	command -v "$bin" >/dev/null || { echo "error    $bin is required" >&2; exit 1; }
done

show() { printf '\n> %s\n' "$*"; }

# 1. Catalog search: public, no key. A ready-made asset is instant.
show "GET $API/api/catalog?q=chair&kind=object&limit=3"
catalog=$(curl -sS --fail-with-body "$API/api/catalog?q=chair&kind=object&limit=3")
echo "$catalog" | jq -r '.items[] | "catalog  \(.title)  \(.url)"'
first_catalog_glb=$(echo "$catalog" | jq -r '.items[0].url // empty')

render() {
	local glb="$1"
	show "GET $API/api/render/glb?glbUrl=<glb>&width=1024&height=1024"
	local code
	code=$(curl -sS -G "$API/api/render/glb" --data-urlencode "glbUrl=$glb" -d width=1024 -d height=1024 -o "$OUT" -w '%{http_code}')
	if [ "$code" != 200 ]; then
		echo "error    render answered HTTP $code: $(head -c 300 "$OUT")" >&2
		exit 1
	fi
	echo "png      $OUT ($(wc -c <"$OUT" | tr -d ' ') bytes)"
}

if [ "$rest_only" = 1 ]; then
	if [ "$catalog_only" = 1 ] || [ -z "${THREE_WS_API_KEY:-}" ]; then
		[ "$catalog_only" = 1 ] || echo "note     THREE_WS_API_KEY is not set, so no model is made; rendering the catalog result (free key: https://three.ws/dashboard/api-keys)"
		[ -n "$first_catalog_glb" ] || { echo "error    the catalog returned no chair" >&2; exit 1; }
		render "$first_catalog_glb"
		echo "glb      $first_catalog_glb"
		exit 0
	fi

	# 2. Make a model on the free lane: needs a free three.ws account (API key).
	body=$(jq -n --arg prompt "$prop" '{prompt: $prompt, backend: "nvidia", path: "image"}')
	show "POST $API/api/forge  authorization: Bearer <THREE_WS_API_KEY>  $body"
	started=$(date +%s)
	headers=$(mktemp)
	trap 'rm -f "$headers"' EXIT
	# A busy GPU fleet answers 429 or 503 with Retry-After: wait that long and resubmit.
	for attempt in 1 2 3 4 5; do
		submit=$(curl -sS -X POST "$API/api/forge" \
			-H 'content-type: application/json' \
			-H "authorization: Bearer ${THREE_WS_API_KEY}" \
			-D "$headers" -d "$body" -w '\n%{http_code}')
		code="${submit##*$'\n'}"
		submit="${submit%$'\n'*}"
		case "$code" in 429 | 503) ;; *) break ;; esac
		[ "$attempt" -lt 5 ] || break
		wait_s=$(tr -d '\r' <"$headers" | awk 'tolower($1) == "retry-after:" { print $2 }' | grep -E '^[0-9]+$' || echo 15)
		[ "$wait_s" -le 60 ] || wait_s=60
		echo "busy     HTTP $code, trying again in ${wait_s}s (attempt $((attempt + 1)) of 5)"
		sleep "$wait_s"
	done
	glb=$(echo "$submit" | jq -r 'select(.status == "done") | .glb_url // empty')
	job=$(echo "$submit" | jq -r '.job_id // empty')
	if [ -z "$glb" ] && [ -z "$job" ]; then
		echo "error    forge answered: $(echo "$submit" | head -c 400)" >&2
		exit 1
	fi

	# 3. Poll the job (public, no key) until it is done.
	if [ -z "$glb" ]; then
		show "GET $API/api/forge?job=<job_id>   (every 5s)"
		while :; do
			sleep 5
			state=$(curl -sS "$API/api/forge?job=$job" -H 'accept: application/json')
			status=$(echo "$state" | jq -r '.status // "unknown"')
			case "$status" in
				done) glb=$(echo "$state" | jq -r '.glb_url'); break ;;
				failed) echo "error    generation failed: $(echo "$state" | jq -r '.error // .message // "unknown"')" >&2; exit 1 ;;
			esac
			elapsed=$(( $(date +%s) - started ))
			echo "job      $status after ${elapsed}s"
			[ "$elapsed" -lt "$POLL_BUDGET_S" ] || { echo "error    still $status after ${elapsed}s; poll $API/api/forge?job=$job later" >&2; exit 1; }
		done
	fi
	echo "glb      $glb  (made in $(( $(date +%s) - started ))s)"
	echo "viewer   https://three.ws/viewer?src=$(jq -rn --arg u "$glb" '$u|@uri')"
	render "$glb"
	exit 0
fi

# 2. Grok drives the studio server: one Responses API call with a remote MCP tool.
if [ -z "$XAI_KEY" ]; then
	echo "error    set XAI_API_KEY (create one at https://console.x.ai), or run with --three-ws-only" >&2
	exit 2
fi
[ -n "${THREE_WS_API_KEY:-}" ] || echo "note     THREE_WS_API_KEY is not set: catalog search works, but making a model needs a free key from https://three.ws/dashboard/api-keys" >&2

tool=$(jq -n --arg url "$MCP_URL" --arg auth "${THREE_WS_API_KEY:-}" '{
	type: "mcp",
	server_url: $url,
	server_label: "three-ws",
	server_description: "Free 3D studio: search CC0 3D assets, or make a textured GLB from one sentence.",
	allowed_tools: ["search_catalog", "forge_free", "check_job"]
} + (if $auth == "" then {} else {authorization: $auth} end)')

ask="Use three-ws to find a chair in the free catalog, and if none fits, make $prop. A generation can come back pending with a job_id: collect it with check_job. When you have the model, reply with one line per field: 'GLB: <url>' and 'Viewer: <url>'."
body=$(jq -n --arg model "$MODEL" --arg ask "$ask" --argjson tool "$tool" '{model: $model, input: [{role: "user", content: $ask}], tools: [$tool]}')

grok() {
	local payload="$1" res code
	show "POST https://api.x.ai/v1/responses  authorization: Bearer <XAI_API_KEY>"
	echo "$payload" | jq '(.tools[0].authorization |= if . then "<THREE_WS_API_KEY>" else . end)' >&2
	res=$(curl -sS https://api.x.ai/v1/responses \
		-H 'content-type: application/json' \
		-H "authorization: Bearer $XAI_KEY" \
		-d "$payload" -w '\n%{http_code}')
	code="${res##*$'\n'}"
	res="${res%$'\n'*}"
	if [ "$code" != 200 ]; then
		echo "error    xAI answered HTTP $code: $res" >&2
		exit 1
	fi
	printf '%s' "$res"
}

response=$(grok "$body")
for round in $(seq 1 "$MAX_ROUNDS"); do
	echo "$response" | jq -r '.output[] | select(.type == "mcp_call") | "tool     \(.name) \(.arguments)"'
	text=$(echo "$response" | jq -r '[.output[] | select(.type == "message") | .content[] | select(.type == "output_text") | .text] | join("\n")')
	glb=$(printf '%s' "$text" | grep -oE 'https?://[^ )"]+\.glb(\?[^ )"]*)?' | head -1 || true)
	if [ -n "$glb" ]; then
		printf '\n%s\n\n' "$text"
		echo "glb      $glb"
		render "$glb"
		exit 0
	fi
	echo "round $round: no GLB yet, asking Grok to collect the job again in 20s"
	sleep 20
	id=$(echo "$response" | jq -r '.id')
	next=$(jq -n --arg model "$MODEL" --arg id "$id" --argjson tool "$tool" \
		'{model: $model, previous_response_id: $id, input: [{role: "user", content: "Call check_job on that job again. When it is done, reply with GLB: <url> and Viewer: <url>."}], tools: [$tool]}')
	response=$(grok "$next")
done
echo "error    no GLB after $MAX_ROUNDS rounds" >&2
exit 1
