# NVIDIA Cosmos Reason 2 8B (NVIDIA Open Model License) on vLLM's OpenAI-compatible
# server, for a Cloud Run L4. The Forge quality gate uses it as a physical-
# plausibility judge over multi-view renders (api/_lib/cosmos-reason-judge.js).
#
# The base is the stock, pinned vLLM image (the same tag model-phi runs). Weights
# are not baked in: they live checksummed in gs://three-ws-model-weights/cosmos-reason2-8b
# (cloudbuild.weights.yaml, sourced from NGC) and reach the container on a
# read-only GCS FUSE mount at /weights; serve.sh checks them before vLLM starts.
ARG VLLM_IMAGE=vllm/vllm-openai:v0.29.0
FROM ${VLLM_IMAGE}

ARG COSMOS_REVISION=hf-0303
ENV COSMOS_REVISION=${COSMOS_REVISION} \
    HF_HUB_OFFLINE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=8080

WORKDIR /app
COPY serve.sh /app/
RUN chmod +x /app/serve.sh

EXPOSE 8080
ENTRYPOINT ["/app/serve.sh"]
