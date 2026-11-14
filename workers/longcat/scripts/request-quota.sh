#!/usr/bin/env bash
# Request the 80 GB GPU quota the LongCat video-avatar host needs.
#
#   workers/longcat/scripts/request-quota.sh            # print the plan and the live state, change nothing
#   workers/longcat/scripts/request-quota.sh --submit   # create the quota preferences (idempotent)
#
# A quota preference is a request to Google, not a spend: nothing is billed until a
# VM is created. Each preference is named lc-<quota>-<region> so a re-run updates
# the same request instead of stacking duplicates. Cloud Quotas is called with
# --billing-project because gcloud's own client project does not have the API on.
set -euo pipefail

PROJECT="${GCP_PROJECT:-aerial-vehicle-466722-p5}"
SERVICE="compute.googleapis.com"
JUSTIFICATION="${QUOTA_JUSTIFICATION:-three.ws talking-avatar video worker (LongCat-Video-Avatar-1.5, MIT). The resident weight set is 44.7 GB, so it needs one 80 GB GPU (A100-80GB or H100-80GB); no 24 GB or 40 GB part fits. One GPU, started on demand and stopped after a short idle window, under a hard daily GPU-hour cap. Funded by the Google for Startups Web3 grant credits.}"

# quota-id | dimensions | preferred value | note
# The four us-central1/us-east4 rows were filed 2026-11-04 and DENIED the same day.
# Google has only ever approved this project's GPU increases outside the US
# (L4 to 8 in europe-west4 and asia-southeast1, 2026-07-28), and both regions
# carry a2-ultragpu-1g and a3-highgpu-1g, so those rows were added 2026-11-14.
# On-demand H100 has no per-GPU quota id; it is GPUS-PER-GPU-FAMILY keyed by
# gpu_family as well as region.
REQUESTS=(
	"NVIDIA-A100-80GB-GPUS-per-project-region|region=us-central1|1|on-demand A100-80GB, a2-ultragpu-1g (denied 2026-11-04)"
	"PREEMPTIBLE-NVIDIA-A100-80GB-GPUS-per-project-region|region=us-central1|1|Spot A100-80GB, same shape at a lower price (denied 2026-11-04)"
	"PREEMPTIBLE-NVIDIA-H100-GPUS-per-project-region|region=us-central1|1|Spot H100-80GB, a3-highgpu-1g (denied 2026-11-04)"
	"NVIDIA-A100-80GB-GPUS-per-project-region|region=us-east4|1|alternate region, on-demand A100-80GB (denied 2026-11-04)"
	"NVIDIA-A100-80GB-GPUS-per-project-region|region=europe-west4|1|on-demand A100-80GB, a2-ultragpu-1g in europe-west4-a/b"
	"NVIDIA-A100-80GB-GPUS-per-project-region|region=asia-southeast1|1|on-demand A100-80GB, a2-ultragpu-1g in asia-southeast1-c"
	"GPUS-PER-GPU-FAMILY-per-project-region|region=europe-west4,gpu_family=NVIDIA_H100|1|on-demand H100-80GB, a3-highgpu-1g in europe-west4-b/c"
	"PREEMPTIBLE-NVIDIA-A100-80GB-GPUS-per-project-region|region=europe-west4|1|Spot A100-80GB in europe-west4"
)

submit=0
[[ "${1:-}" == "--submit" ]] && submit=1

echo "Project: ${PROJECT}"
echo
echo "Live regional GPU quotas (limit / usage):"
for region in us-central1 us-east4 europe-west4 asia-southeast1; do
	gcloud compute regions describe "${region}" --project "${PROJECT}" --format=json \
		| python3 -c '
import json, sys
d = json.load(sys.stdin)
for q in d["quotas"]:
    if ("A100" in q["metric"] or "H100" in q["metric"]) and not q["metric"].startswith("COMMITTED"):
        print("  %-12s %-42s %5s / %s" % (d["name"], q["metric"], q["limit"], q["usage"]))'
done
echo
echo "Existing LongCat quota preferences:"
gcloud beta quotas preferences list --project "${PROJECT}" --billing-project "${PROJECT}" \
	--format="value(name.basename(),quotaConfig.preferredValue,quotaConfig.grantedValue,quotaConfig.stateDetail)" 2>/dev/null \
	| grep '^lc-' || echo "  none"
echo
echo "Console: https://console.cloud.google.com/iam-admin/quotas?project=${PROJECT} (filter: NVIDIA A100 80GB GPUs)"
echo

for row in "${REQUESTS[@]}"; do
	IFS='|' read -r quota dims value note <<<"${row}"
	# lc-<quota>-<dimension values>: stable across re-runs, so --submit never stacks duplicates.
	dim_values="$(tr ',' '\n' <<<"${dims}" | cut -d= -f2 | paste -sd- -)"
	pref="lc-$(echo "${quota}-${dim_values}" | tr '[:upper:]_' '[:lower:]-' | sed 's/-per-project-region//')"
	pref="${pref:0:60}"
	echo "- ${note}"
	cmd=(gcloud beta quotas preferences create
		--project "${PROJECT}" --billing-project "${PROJECT}"
		--service "${SERVICE}" --quota-id "${quota}" --preferred-value "${value}"
		--dimensions "${dims}" --preference-id "${pref}"
		--justification "${JUSTIFICATION}" --email "${QUOTA_CONTACT_EMAIL:-$(gcloud config get-value account 2>/dev/null)}"
		--format="value(name.basename(),quotaConfig.preferredValue,quotaConfig.grantedValue,quotaConfig.stateDetail)")
	if [[ "${submit}" -eq 0 ]]; then
		printf '    %q ' "${cmd[@]}"; echo
		continue
	fi
	if out="$("${cmd[@]}" 2>&1)"; then
		echo "    submitted: ${out}"
	elif grep -qi 'already exists' <<<"${out}"; then
		echo "    already requested: ${pref}"
	else
		echo "    not accepted: ${out}" | head -3
	fi
done
