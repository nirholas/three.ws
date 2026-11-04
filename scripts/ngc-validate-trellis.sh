#!/usr/bin/env bash
# Run the TRELLIS NGC candidate on a short-lived GPU VM and collect evidence.
#
#   scripts/ngc-validate-trellis.sh --image <registry-image-with-digest> [--accel a100|l4|h100] [--zone <zone>] [--tier standard]
#
# Creates a spot VM from a Deep Learning image (NVIDIA driver preinstalled), runs
# workers/model-trellis/ngc-validate-vm.sh as its startup script (mounted weights,
# OUTPUT_DIR mode, one real /infer, GLB load check), waits for the VM to power
# off, prints the evidence, and ALWAYS deletes the VM. GCE spend is covered by
# the standing GCP credit approval (CLAUDE.md).
set -euo pipefail

PROJECT=aerial-vehicle-466722-p5
SA="three-ws@${PROJECT}.iam.gserviceaccount.com"
IMAGE=""; ACCEL=a100; ZONE=""; TIER=standard

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
	a100) MACHINE=a2-highgpu-1g; ACCEL_ARGS=() ; ZONE="${ZONE:-us-central1-c}" ;;
	l4)   MACHINE=g2-standard-8; ACCEL_ARGS=() ; ZONE="${ZONE:-us-central1-a}" ;;
	h100) MACHINE=a3-highgpu-1g; ACCEL_ARGS=() ; ZONE="${ZONE:-us-central1-a}" ;;
	*) echo "unknown --accel $ACCEL" >&2; exit 64 ;;
esac

RUN="$(date +%Y%m%d-%H%M%S)-${ACCEL}"
VM="ngc-validate-${RUN}"
EVIDENCE="gs://three-ws-model-weights/ngc-validation/${RUN}"
HERE="$(cd "$(dirname "$0")/.." && pwd)"

cleanup() {
	gcloud compute instances delete "$VM" --zone "$ZONE" --project "$PROJECT" --quiet >/dev/null 2>&1 || true
	echo "VM $VM deleted. Remaining instances:"
	gcloud compute instances list --project "$PROJECT" --format='table(name,zone.basename(),status)'
}
trap cleanup EXIT

gcloud compute instances create "$VM" --project "$PROJECT" --zone "$ZONE" \
	--machine-type "$MACHINE" --provisioning-model SPOT --instance-termination-action DELETE \
	--maintenance-policy TERMINATE --boot-disk-size 300GB --boot-disk-type pd-ssd \
	--image-family common-cu129-ubuntu-2204-nvidia-580 --image-project deeplearning-platform-release \
	--service-account "$SA" --scopes cloud-platform \
	--metadata "image=${IMAGE},evidence=${EVIDENCE},tier=${TIER}" \
	--metadata-from-file "startup-script=${HERE}/workers/model-trellis/ngc-validate-vm.sh"

echo "VM $VM created in $ZONE. Waiting for it to power off (up to 90 minutes)..."
for _ in $(seq 1 180); do
	STATUS="$(gcloud compute instances describe "$VM" --zone "$ZONE" --project "$PROJECT" --format='value(status)' 2>/dev/null || echo GONE)"
	[ "$STATUS" = TERMINATED ] || [ "$STATUS" = STOPPED ] || [ "$STATUS" = GONE ] && break
	sleep 30
done
echo "Evidence at ${EVIDENCE}:"
gsutil cat "${EVIDENCE}/evidence.json" || { echo "no evidence.json written; run log:"; gsutil cat "${EVIDENCE}/run.log" | tail -80; exit 1; }
