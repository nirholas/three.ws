# Phi-4-mini-instruct (MIT) on vLLM's OpenAI-compatible server, for a Cloud Run L4.
#
# The base is the stock, pinned vLLM image (the same tag granite-guardian
# runs). Weights are not baked in: they live checksummed in
# gs://three-ws-model-weights/phi-4-mini-instruct (cloudbuild.weights.yaml) and
# reach the container on a read-only GCS FUSE mount at /weights; serve.sh checks
# them against MANIFEST.json before vLLM starts. What this layer adds:
#   phi_tool_parser.py / phi_tool_format.py  streamed + non-streamed tool calls
#   chat_template.jinja                      native tool turns, results, replays
#   bench.py / bench_job.sh                  the Cloud Run job verification run
ARG VLLM_IMAGE=vllm/vllm-openai:v0.29.0
FROM ${VLLM_IMAGE}

ARG PHI_REVISION=cfbefacb99257ffa30c83adab238a50856ac3083
ENV PHI_REVISION=${PHI_REVISION} \
    HF_HUB_OFFLINE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=8080

WORKDIR /app
COPY phi_tool_format.py phi_tool_parser.py chat_template.jinja serve.sh bench.py bench_job.sh /app/
RUN chmod +x /app/serve.sh /app/bench_job.sh \
 && python3 -c "import ast,sys; [ast.parse(open(f).read(), f) for f in ('/app/phi_tool_format.py','/app/phi_tool_parser.py','/app/bench.py')]"

EXPOSE 8080
ENTRYPOINT ["/app/serve.sh"]
