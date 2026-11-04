#!/usr/bin/env bash
# Stand up the production autopilot on Google Cloud. Idempotent: every create is
# guarded by a describe check, nothing is deleted, and no env var is ever set
# with --set-env-vars. Safe to re-run; a second run only reports "exists".
#
# USAGE
#   services/autopilot/provision.sh [--no-ship] [--dry-run]
#
#   --no-ship   the VM runs Claude but never tests, pushes or deploys
#               (AUTOPILOT_NO_SHIP=1 in /etc/autopilot/env). Use for the first boot.
#   --dry-run   print every gcloud command instead of running it.
#
# ENV
#   AUTOPILOT_TELEGRAM_CHAT_ID   private ops chat id, passed as VM metadata.
#   AUTOPILOT_PROJECT, AUTOPILOT_ZONE, AUTOPILOT_MACHINE  overrides.
#
# It never creates the push credential. The last line it prints is the owner
# command that does.

set -euo pipefail

PROJECT="${AUTOPILOT_PROJECT:-aerial-vehicle-466722-p5}"
ZONE="${AUTOPILOT_ZONE:-us-central1-a}"
REGION="${ZONE%-*}"
MACHINE="${AUTOPILOT_MACHINE:-e2-standard-8}"
VM=three-ws-autopilot
BUCKET=three-ws-autopilot
SA_NAME=three-ws-autopilot
SA="$SA_NAME@$PROJECT.iam.gserviceaccount.com"
BUILD_SA="three-ws-build@$PROJECT.iam.gserviceaccount.com"
GH_SECRET=autopilot-github-token
CDN_ROLE=autopilotCdnInvalidate
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

NO_SHIP=0
DRY=0
for arg in "$@"; do
	case "$arg" in
		--no-ship) NO_SHIP=1 ;;
		--dry-run) DRY=1 ;;
		-h|--help) sed -n '2,19p' "${BASH_SOURCE[0]}"; exit 0 ;;
		*) echo "unknown flag: $arg" >&2; exit 2 ;;
	esac
done

say() { printf '[provision] %s\n' "$*"; }
run() {
	if [ "$DRY" = 1 ]; then printf '  + %s\n' "$*"; else "$@"; fi
}
exists() { "$@" >/dev/null 2>&1; }

for f in autopilot.service autopilot.timer bootstrap.sh run.sh; do
	[ -f "$HERE/$f" ] || { echo "missing $HERE/$f" >&2; exit 1; }
done

say "project $PROJECT, zone $ZONE"
run gcloud services enable compute.googleapis.com secretmanager.googleapis.com storage.googleapis.com \
	cloudbuild.googleapis.com run.googleapis.com cloudscheduler.googleapis.com aiplatform.googleapis.com \
	iam.googleapis.com logging.googleapis.com --project "$PROJECT"

# Runtime service account
if exists gcloud iam service-accounts describe "$SA" --project "$PROJECT"; then
	say "service account $SA exists"
else
	say "creating service account $SA"
	run gcloud iam service-accounts create "$SA_NAME" --project "$PROJECT" --display-name "three.ws autopilot VM"
fi

grant() {
	run gcloud projects add-iam-policy-binding "$PROJECT" --member "serviceAccount:$SA" --role "$1" --condition=None --quiet >/dev/null
}
say "granting project roles"
grant roles/run.admin
grant roles/cloudscheduler.admin
grant roles/aiplatform.user
grant roles/logging.viewer
grant roles/cloudbuild.builds.editor

say "allowing it to act as the pinned build account"
run gcloud iam service-accounts add-iam-policy-binding "$BUILD_SA" --project "$PROJECT" \
	--member "serviceAccount:$SA" --role roles/iam.serviceAccountUser --quiet >/dev/null

# The deploy also updates three-ws-api, which runs as the runtime account.
RUNTIME_SA="three-ws@$PROJECT.iam.gserviceaccount.com"
run gcloud iam service-accounts add-iam-policy-binding "$RUNTIME_SA" --project "$PROJECT" \
	--member "serviceAccount:$SA" --role roles/iam.serviceAccountUser --quiet >/dev/null

# CDN purge needs exactly one permission; a custom role keeps it that narrow.
if exists gcloud iam roles describe "$CDN_ROLE" --project "$PROJECT"; then
	say "role $CDN_ROLE exists"
else
	say "creating role $CDN_ROLE"
	run gcloud iam roles create "$CDN_ROLE" --project "$PROJECT" --title "Autopilot CDN invalidate" \
		--permissions compute.urlMaps.invalidateCache,compute.urlMaps.get --stage GA
fi
grant "projects/$PROJECT/roles/$CDN_ROLE"

# Secrets: read-only on the two it needs. The GitHub secret value is never created here.
# DATABASE_URL is the one service secret a tick reads (scripts/read-service-env.mjs).
for secret in telegram-bot-token "$GH_SECRET" DATABASE_URL; do
	if exists gcloud secrets describe "$secret" --project "$PROJECT"; then
		run gcloud secrets add-iam-policy-binding "$secret" --project "$PROJECT" \
			--member "serviceAccount:$SA" --role roles/secretmanager.secretAccessor --quiet >/dev/null
	else
		say "secret $secret does not exist yet; bind $SA to it after creating it"
	fi
done

# Bucket
if exists gcloud storage buckets describe "gs://$BUCKET" --project "$PROJECT"; then
	say "bucket gs://$BUCKET exists"
else
	say "creating bucket gs://$BUCKET"
	run gcloud storage buckets create "gs://$BUCKET" --project "$PROJECT" --location "$REGION" --uniform-bucket-level-access
fi
LIFECYCLE="$(mktemp)"
printf '{"rule":[{"action":{"type":"Delete"},"condition":{"age":90,"matchesPrefix":["runs/"]}}]}\n' >"$LIFECYCLE"
run gcloud storage buckets update "gs://$BUCKET" --project "$PROJECT" --lifecycle-file "$LIFECYCLE"
rm -f "$LIFECYCLE"
run gcloud storage buckets add-iam-policy-binding "gs://$BUCKET" --member "serviceAccount:$SA" --role roles/storage.objectAdmin --quiet >/dev/null

# VM
META_FILES="startup-script=$HERE/bootstrap.sh,autopilot-unit-service=$HERE/autopilot.service,autopilot-unit-timer=$HERE/autopilot.timer"
META_KV=""
[ "$NO_SHIP" = 1 ] && META_KV="autopilot-no-ship=1"
if [ -n "${AUTOPILOT_TELEGRAM_CHAT_ID:-}" ]; then
	META_KV="${META_KV:+$META_KV,}autopilot-telegram-chat-id=$AUTOPILOT_TELEGRAM_CHAT_ID"
fi

if exists gcloud compute instances describe "$VM" --zone "$ZONE" --project "$PROJECT"; then
	say "VM $VM exists; refreshing its metadata (units, startup script, flags)"
	run gcloud compute instances add-metadata "$VM" --zone "$ZONE" --project "$PROJECT" \
		--metadata-from-file "$META_FILES" ${META_KV:+--metadata "$META_KV"}
else
	say "creating VM $VM ($MACHINE)"
	run gcloud compute instances create "$VM" --zone "$ZONE" --project "$PROJECT" \
		--machine-type "$MACHINE" --image-family debian-12 --image-project debian-cloud \
		--boot-disk-size 200GB --boot-disk-type pd-balanced \
		--service-account "$SA" --scopes cloud-platform \
		--metadata-from-file "$META_FILES" ${META_KV:+--metadata "$META_KV"}
fi
[ "$NO_SHIP" = 1 ] && say "no-ship mode: the VM will not test, push or deploy"

cat <<OUT

[provision] done. The push credential is the one thing this script will not create.
When you want the autopilot to ship, run (paste a GitHub token that can push to nirholas/three.ws on stdin):

  gcloud secrets create $GH_SECRET --project $PROJECT --replication-policy automatic --data-file=- \\
    && gcloud secrets add-iam-policy-binding $GH_SECRET --project $PROJECT \\
         --member serviceAccount:$SA --role roles/secretmanager.secretAccessor

Then re-run this script without --no-ship, and restart the timer:
  gcloud compute ssh $VM --zone $ZONE --project $PROJECT --command 'sudo sed -i /AUTOPILOT_NO_SHIP/d /etc/autopilot/env && sudo systemctl restart autopilot.timer'
OUT
