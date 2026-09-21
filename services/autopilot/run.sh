#!/usr/bin/env bash
# One autopilot tick: sync main, sweep production, let Claude fix what it may,
# then gate, push, deploy, verify, and roll back on a failed verification.
#
# Runs as the `autopilot` user on the three-ws-autopilot VM, started every two
# hours by autopilot.timer. See README.md in this directory.
#
#   run.sh                       full tick
#   AUTOPILOT_NO_SHIP=1 run.sh   run Claude, but never push or deploy
#   AUTOPILOT_DRY_RUN=1 run.sh   sync + triage + gating decision only
#
# The whole body lives in main() so bash parses it before running it: the tick
# resets this very file to the newest main, and bash reads scripts lazily.

set -uo pipefail

PROJECT="${AUTOPILOT_PROJECT:-aerial-vehicle-466722-p5}"
REGION="${AUTOPILOT_REGION:-us-central1}"
SERVICE="three-ws-api"
BASE_DIR="${AUTOPILOT_HOME:-$HOME}"
REPO="$BASE_DIR/three.ws"
RUNS="$BASE_DIR/runs"
BUCKET="${AUTOPILOT_BUCKET:-gs://three-ws-autopilot}"
MODEL="${AUTOPILOT_MODEL:-claude-opus-5}"
CLAUDE_TIMEOUT="${AUTOPILOT_CLAUDE_TIMEOUT:-100m}"
DEFER_HOURS="${AUTOPILOT_DEFER_HOURS:-24}"
GH_SECRET="${AUTOPILOT_GH_SECRET:-autopilot-github-token}"
SITE="https://three.ws"

log() { printf '[autopilot %s] %s\n' "$(date -u +%H:%M:%S)" "$*"; }

# status.json is the machine-readable record of the tick; notify.mjs and the
# next tick's history both read it.
note() {
	local tmp="$STATUS.tmp"
	jq --arg k "$1" --arg v "$2" '.[$k] = $v' "$STATUS" >"$tmp" && mv "$tmp" "$STATUS"
}

finish() {
	note finished_at "$(date -u +%FT%TZ)"
	node "$REPO/services/autopilot/notify.mjs" "$AUTOPILOT_RUN_DIR" || log "notify failed"
	gcloud storage cp --recursive --quiet "$AUTOPILOT_RUN_DIR" "$BUCKET/runs/" >/dev/null 2>&1 ||
		log "report upload to $BUCKET failed"
	find "$RUNS" -mindepth 1 -maxdepth 1 -type d -mtime +14 -exec rm -rf {} + 2>/dev/null
	exit "${1:-0}"
}

sync_repo() {
	cd "$REPO" || return 1
	PREV_HEAD="$(git rev-parse HEAD)"
	git fetch --quiet threews main || return 1
	git checkout --quiet --force -B main threews/main || return 1
	git clean -fdq
	note head_before "$PREV_HEAD"
	note head "$(git rev-parse HEAD)"
}

changed_since_prev() {
	[ "$PREV_HEAD" != "$(git rev-parse HEAD)" ] && ! git diff --quiet "$PREV_HEAD" HEAD -- "$@"
}

install_deps() {
	if [ ! -d node_modules ] || changed_since_prev package-lock.json; then
		log "lockfile changed: npm ci"
		npm ci --no-audit --no-fund || return 1
		npx playwright install chromium || return 1
	else
		npm run --silent postinstall || return 1
	fi
	npm run --silent deps:chat || return 1
	if [ ! -f character-studio/build/index.html ] || changed_since_prev character-studio; then
		log "character-studio changed: rebuilding avatar studio"
		npm ci --prefix character-studio --no-audit --no-fund || return 1
		npm run build:avatar-studio || return 1
	fi
}

# The runtime env the repo scripts expect. DATABASE_URL is read from the live
# service every tick so a rotated credential never goes stale here.
write_env() {
	local db
	db="$(node scripts/read-service-env.mjs '^DATABASE_URL$' --raw)" || return 1
	umask 077
	printf 'DATABASE_URL=%s\n' "$db" >.env.local
	: >.env
}

run_triage() {
	npm run --silent triage:gcp -- --json --deep --since 3h >"$AUTOPILOT_RUN_DIR/triage.json" 2>"$AUTOPILOT_RUN_DIR/triage.stderr"
	local code=$?
	note triage_exit "$code"
	note verdict_before "$(jq -r 'if .healthy then "healthy" else "unhealthy" end' "$AUTOPILOT_RUN_DIR/triage.json" 2>/dev/null || echo unknown)"
	return 0
}

# Signatures Claude is allowed to act on, minus the ones it already deferred
# within DEFER_HOURS. Owner and self-healing findings never wake Claude.
actionable_signatures() {
	local deferred="$BASE_DIR/deferred.json"
	[ -f "$deferred" ] || echo '{}' >"$deferred"
	jq -r --slurpfile d "$deferred" --argjson h "$DEFER_HOURS" '
		($d[0] // {}) as $def
		| [.findings[]? | select(.class == "env-action" or .class == "investigate") | .signature]
		| unique[]
		| select(($def[.] // null) == null or ((now - ($def[.] | fromdateiso8601)) > ($h * 3600)))
	' "$AUTOPILOT_RUN_DIR/triage.json"
}

record_deferrals() {
	local deferred="$BASE_DIR/deferred.json" result="$AUTOPILOT_RUN_DIR/result.json"
	[ -f "$result" ] || return 0
	jq --slurpfile r "$result" --arg now "$(date -u +%FT%TZ)" '
		reduce (($r[0].deferred // [])[] | (.signature // .)) as $s (.; .[$s] = (.[$s] // $now))
	' "$deferred" >"$deferred.tmp" && mv "$deferred.tmp" "$deferred"
}

write_history() {
	AUTOPILOT_HISTORY="$AUTOPILOT_RUN_DIR/history.jsonl"
	if [ -f "$BASE_DIR/history.jsonl" ]; then
		tail -n 8 "$BASE_DIR/history.jsonl" | tac >"$AUTOPILOT_HISTORY"
	else
		echo '{"note":"first run, no history yet"}' >"$AUTOPILOT_HISTORY"
	fi
	export AUTOPILOT_HISTORY
}

append_history() {
	jq -c --slurpfile r <(cat "$AUTOPILOT_RUN_DIR/result.json" 2>/dev/null || echo '{}') \
		'. + {result: ($r[0] // {})}' "$STATUS" >>"$BASE_DIR/history.jsonl"
}

run_claude() {
	mkdir -p "$HOME/.claude"
	cp services/autopilot/claude-settings.json "$HOME/.claude/settings.json"
	git config user.name "three.ws autopilot"
	git config user.email "autopilot@three.ws"

	local prompt
	prompt="$(envsubst '${AUTOPILOT_RUN_DIR} ${AUTOPILOT_HISTORY}' <services/autopilot/prompt.md)"
	CLAUDE_CODE_USE_VERTEX=1 ANTHROPIC_VERTEX_PROJECT_ID="$PROJECT" CLOUD_ML_REGION=global \
		timeout --kill-after=2m "$CLAUDE_TIMEOUT" \
		claude -p "$prompt" --model "$MODEL" --permission-mode bypassPermissions \
		--output-format stream-json --verbose >"$AUTOPILOT_RUN_DIR/claude.jsonl" 2>"$AUTOPILOT_RUN_DIR/claude.stderr"
	local code=$?
	note claude_exit "$code"
	note claude_cost_usd "$(jq -r 'select(.type == "result") | .total_cost_usd // empty' "$AUTOPILOT_RUN_DIR/claude.jsonl" 2>/dev/null | tail -1)"

	# Anything Claude left uncommitted is kept for the owner, never shipped.
	if ! git diff --quiet HEAD || [ -n "$(git ls-files --others --exclude-standard)" ]; then
		git add -A --intent-to-add >/dev/null 2>&1
		git diff HEAD >"$AUTOPILOT_RUN_DIR/uncommitted.patch"
		note uncommitted "kept as uncommitted.patch, not shipped"
		git reset --quiet --hard HEAD
		git clean -fdq
	fi
}

# Push credentials come from Secret Manager at push time and live only in this
# process's argv: nothing is written to disk and Claude never sees them.
push_ref() {
	local token
	token="$(gcloud secrets versions access latest --secret="$GH_SECRET" --project "$PROJECT" 2>/dev/null)"
	if [ -z "$token" ]; then
		log "Secret Manager secret $GH_SECRET is missing"
		return 2
	fi
	git -c "http.https://github.com/.extraheader=AUTHORIZATION: basic $(printf 'x-access-token:%s' "$token" | base64 -w0)" \
		push --quiet threews "$1"
}

push_main() {
	push_ref HEAD:main
	case $? in
	0)
		note push "pushed $(git rev-parse --short HEAD) to main"
		return 0
		;;
	2)
		note push "skipped: Secret Manager secret $GH_SECRET is missing"
		return 1
		;;
	esac
	# main moved while Claude worked: replay our commits on top and try once more.
	if ! { git fetch --quiet threews main && git rebase --quiet threews/main; }; then
		git rebase --abort 2>/dev/null
		push_ref "HEAD:refs/heads/autopilot/$TS" && note push "rebase conflict: pushed branch autopilot/$TS for review" ||
			note push "rebase conflict and branch push failed"
		return 1
	fi
	if push_ref HEAD:main; then
		note push "pushed $(git rev-parse --short HEAD) to main after rebase"
		return 0
	fi
	note push "push rejected (see run.log; the pre-push hook runs check:rules)"
	return 1
}

serving_revision() {
	gcloud run services describe "$SERVICE" --region "$REGION" --project "$PROJECT" --format=json |
		jq -r '(.status.traffic[]? | select(.percent == 100) | .revisionName) // .status.latestReadyRevisionName' | head -1
}

healthz_code() { curl -s -o /dev/null -w '%{http_code}' --max-time 20 "$SITE/api/healthz"; }

# The steps of `npm run deploy:gcp:full`, split so traffic can be moved back to
# latest between submit and smoke: after a rollback pins traffic to an old
# revision, a plain `gcloud run deploy` no longer receives traffic, and the
# smoke test would silently test the old revision.
deploy() {
	local prev_rev health_before new_rev sha
	prev_rev="$(serving_revision)"
	health_before="$(healthz_code)"
	note deploy_prev_revision "$prev_rev"

	npm run clean:worktrees -- --apply >/dev/null 2>&1
	if ! { npm run build:gcp && npm run check:dist && npm run check:pages; }; then
		note deploy "build failed, nothing submitted"
		return 1
	fi
	if ! npm run deploy:gcp:submit; then
		new_rev="$(gcloud run services describe "$SERVICE" --region "$REGION" --project "$PROJECT" --format='value(status.latestReadyRevisionName)')"
		note deploy "submit failed (latest ready revision $new_rev, serving $(serving_revision))"
		return 1
	fi
	gcloud run services update-traffic "$SERVICE" --to-latest --region "$REGION" --project "$PROJECT" --quiet
	npm run deploy:gcp:purge-cdn
	new_rev="$(serving_revision)"
	note deploy_revision "$new_rev"

	local failed=""
	npm run smoke:prod || failed="smoke:prod failed"
	sha="$(curl -s --max-time 20 "$SITE/api/version" | jq -r '.commit // empty')"
	case "$(git rev-parse HEAD)" in "$sha"*) ;; *) [ -n "$failed" ] || failed="/api/version reports ${sha:-nothing}, expected $(git rev-parse --short HEAD)" ;; esac
	if [ "$health_before" = "200" ] && [ "$(healthz_code)" != "200" ]; then
		[ -n "$failed" ] || failed="healthz regressed from 200"
	fi

	if [ -z "$failed" ]; then
		note deploy "live: $new_rev at $(git rev-parse --short HEAD)"
		return 0
	fi
	log "verification failed ($failed): rolling back to $prev_rev"
	gcloud run services update-traffic "$SERVICE" --to-revisions="$prev_rev=100" --region "$REGION" --project "$PROJECT" --quiet &&
		npm run deploy:gcp:purge-cdn
	note deploy "rolled back to $prev_rev: $failed"
	note rollback "$prev_rev"
	return 1
}

main() {
	mkdir -p "$RUNS"
	exec 9>"$BASE_DIR/.autopilot.lock"
	if ! flock -n 9; then
		log "previous tick still running, skipping"
		exit 0
	fi

	TS="$(date -u +%Y%m%dT%H%M%SZ)"
	export AUTOPILOT_RUN_DIR="$RUNS/$TS"
	mkdir -p "$AUTOPILOT_RUN_DIR"
	STATUS="$AUTOPILOT_RUN_DIR/status.json"
	jq -n --arg ts "$TS" '{ts: $ts}' >"$STATUS"
	exec > >(tee -a "$AUTOPILOT_RUN_DIR/run.log") 2>&1

	log "tick $TS"
	sync_repo || { note error "git sync failed"; finish 1; }
	install_deps || { note error "dependency install failed"; finish 1; }
	write_env || { note error "could not read DATABASE_URL from $SERVICE"; finish 1; }
	run_triage

	local sigs
	sigs="$(actionable_signatures)"
	note actionable "$(echo "$sigs" | grep -c . || true)"
	if [ -z "$sigs" ]; then
		note claude "skipped: nothing Claude may act on"
		append_history
		finish 0
	fi
	log "actionable: $(echo "$sigs" | tr '\n' ' ')"
	if [ -n "${AUTOPILOT_DRY_RUN:-}" ]; then
		note claude "skipped: dry run"
		finish 0
	fi

	write_history
	local base
	base="$(git rev-parse HEAD)"
	run_claude
	record_deferrals

	local commits want_deploy
	commits="$(git rev-list --count "$base"..HEAD)"
	want_deploy="$(jq -r '.deploy // false' "$AUTOPILOT_RUN_DIR/result.json" 2>/dev/null || echo false)"
	note commits "$commits"
	if [ "$commits" = "0" ] && [ "$want_deploy" != "true" ]; then
		note ship "nothing to ship"
		append_history
		finish 0
	fi
	if [ -n "${AUTOPILOT_NO_SHIP:-}" ]; then
		note ship "skipped: AUTOPILOT_NO_SHIP"
		append_history
		finish 0
	fi

	if [ "$commits" != "0" ]; then
		if ! npm test >"$AUTOPILOT_RUN_DIR/test.log" 2>&1; then
			note tests "failed (test.log); commits held back"
			push_ref "HEAD:refs/heads/autopilot/$TS" && note push "pushed branch autopilot/$TS for review"
			append_history
			finish 1
		fi
		note tests "passed"
		push_main || { note ship "not deployed: push did not land"; append_history; finish 1; }
	fi

	deploy
	local code=$?
	append_history
	finish "$code"
}

main "$@"
