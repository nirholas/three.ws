#!/usr/bin/env bash
# Run the TRELLIS NGC candidate on a short-lived GPU VM and collect evidence.
#
#   scripts/ngc-validate-trellis.sh --image <registry-image-with-digest> [--accel a100|l4|h100] [--zone <zone>] [--tier standard]
#
# Without --zone it tries each zone in the accelerator's list until one has spot
# capacity (GPU stockouts are per zone and change by the hour).
#
# Creates a spot VM from a Deep Learning image (NVIDIA driver preinstalled), runs
# workers/model-trellis/ngc-validate-vm.sh as its startup script (mounted weights,
# OUTPUT_DIR mode, one real /infer, GLB load check), waits for the VM to power
# off, prints the evidence, and ALWAYS deletes the VM. GCE spend is covered by
# the standing GCP credit approval (CLAUDE.md).
set -euo pipefail

PROJECT=aerial-vehicle-466722-p5
SA="three-ws@${PROJECT}.iam.gserviceaccount.com"
IMAGE=""; ACCEL=a100; ZONE=""; ZONES=""; TIER=standard

while [ $# -gt 0 ]; do
	case "$1" in
		--image) IMAGE="${2:-}"; shift 2 ;;
		--accel) ACCEL="${2:-}"; shift 2 ;;
		--zone) ZONE="${2:-}"; shift 2 ;;
		--tier) TIER="${2:-}"; shift 2 ;;
		*) echo "unknown argument: $1" >&2; exit 64 ;;
	esac
done
[ -n "$IMAGE" ] || { echo "usage: $0 --image <image> [--accel a100|l4|h100] [--zone Z] [--tier T]" >&2; exit 64; }

case "$ACCEL" in
	a100) MACHINE=a2-highgpu-1g; ZONES="us-central1-c us-central1-a us-central1-f us-east4-c europe-west4-a" ;;
	l4)   MACHINE=g2-standard-8; ZONES="us-central1-a us-central1-b us-central1-c us-east4-a us-east4-c us-east1-c us-west1-a europe-west4-a" ;;
	h100) MACHINE=a3-highgpu-1g; ZONES="us-central1-a us-central1-c us-east4-a europe-west4-b" ;;
	*) echo "unknown --accel $ACCEL" >&2; exit 64 ;;
esac

RUN="$(date +%Y%m%d-%H%M%S)-${ACCEL}"
VM="ngc-validate-${RUN}"
# Evidence goes to its own bucket: the runtime service account the VM runs as can
# write there (roles/storage.objectAdmin on this bucket only) and never needs
# write access to the weights bucket it reads from.
EVIDENCE_BUCKET="gs://three-ws-ngc-validation"
EVIDENCE="${EVIDENCE_BUCKET}/${RUN}"
HERE="$(cd "$(dirname "$0")/.." && pwd)"

[ -n "$ZONE" ] && ZONES="$ZONE"
ZONE=""

if ! gcloud storage buckets describe "$EVIDENCE_BUCKET" --project "$PROJECT" >/dev/null 2>&1; then
	gcloud storage buckets create "$EVIDENCE_BUCKET" --project "$PROJECT" --location us-central1 \
		--uniform-bucket-level-access --public-access-prevention
	gcloud storage buckets add-iam-policy-binding "$EVIDENCE_BUCKET" \
		--member "serviceAccount:${SA}" --role roles/storage.objectAdmin >/dev/null
fi

cleanup() {
	[ -n "$ZONE" ] && gcloud compute instances delete "$VM" --zone "$ZONE" --project "$PROJECT" --quiet >/dev/null 2>&1 || true
	echo "VM $VM deleted. Remaining instances:"
	gcloud compute instances list --project "$PROJECT" --format='table(name,zone.basename(),status)'
}
trap cleanup EXIT

create_in() {
	gcloud compute instances create "$VM" --project "$PROJECT" --zone "$1" \
	--machine-type "$MACHINE" --provisioning-model SPOT --instance-termination-action DELETE \
	--maintenance-policy TERMINATE --boot-disk-size 300GB --boot-disk-type pd-ssd \
	--image-family common-cu129-ubuntu-2204-nvidia-580 --image-project deeplearning-platform-release \
	--service-account "$SA" --scopes cloud-platform \
	--metadata "image=${IMAGE},evidence=${EVIDENCE},tier=${TIER}" \
	--metadata-from-file "startup-script=${HERE}/workers/model-trellis/ngc-validate-vm.sh"
}

for candidate in $ZONES; do
	if create_in "$candidate"; then ZONE="$candidate"; break; fi
	echo "no $ACCEL capacity or quota in $candidate, trying the next zone" >&2
done
[ -n "$ZONE" ] || { echo "no zone in [$ZONES] could create a $MACHINE VM" >&2; exit 1; }

echo "VM $VM created in $ZONE. Waiting for it to power off (up to 90 minutes)..."
for _ in $(seq 1 180); do
	STATUS="$(gcloud compute instances describe "$VM" --zone "$ZONE" --project "$PROJECT" --format='value(status)' 2>/dev/null || echo GONE)"
	[ "$STATUS" = TERMINATED ] || [ "$STATUS" = STOPPED ] || [ "$STATUS" = GONE ] && break
	sleep 30
done
echo "Evidence at ${EVIDENCE}:"
gsutil cat "${EVIDENCE}/evidence.json" || { echo "no evidence.json written; run log:"; gsutil cat "${EVIDENCE}/run.log" | tail -80; exit 1; }
