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

# quota-id | region | preferred value | note
REQUESTS=(
	"NVIDIA-A100-80GB-GPUS-per-project-region|us-central1|1|on-demand A100-80GB, a2-ultragpu-1g (preferred)"
	"PREEMPTIBLE-NVIDIA-A100-80GB-GPUS-per-project-region|us-central1|1|Spot A100-80GB, same shape at a lower price"
	"PREEMPTIBLE-NVIDIA-H100-GPUS-per-project-region|us-central1|1|Spot H100-80GB, a3-highgpu-1g"
	"NVIDIA-A100-80GB-GPUS-per-project-region|us-east4|1|alternate region, on-demand A100-80GB"
)

submit=0
[[ "${1:-}" == "--submit" ]] && submit=1

echo "Project: ${PROJECT}"
echo
echo "Live regional GPU quotas (limit / usage):"
for region in us-central1 us-east4; do
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
	IFS='|' read -r quota region value note <<<"${row}"
	pref="lc-$(echo "${quota}" | tr 'A-Z' 'a-z' | sed 's/-per-project-region//')-${region}"
	pref="${pref:0:60}"
	echo "- ${note}"
	cmd=(gcloud beta quotas preferences create
		--project "${PROJECT}" --billing-project "${PROJECT}"
		--service "${SERVICE}" --quota-id "${quota}" --preferred-value "${value}"
		--dimensions "region=${region}" --preference-id "${pref}"
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
