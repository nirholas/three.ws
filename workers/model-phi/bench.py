"""Verification run for the Phi worker: correctness, latency, throughput, eval.

Runs inside the Cloud Run GPU job (bench_job.sh) against the vLLM server it
started on localhost, using only the standard library. Writes one JSON report:

  boot         container start -> /health 200 (cold start inside the container)
  chat         one non-streamed completion
  stream       time to first token and decode speed of one streamed completion
  tools        a tool call non-streamed and streamed, then the follow-up turn
               that reads the tool result
  load         requests/s, output tokens/s, latency and TTFT percentiles at
               rising concurrency, using the eval prompts as the workload
  eval         every eval task's raw answer (scored later, off the GPU)

    python3 bench.py --base http://127.0.0.1:8080 --tasks tasks.json --out report.json
"""

from __future__ import annotations

import argparse
import json
import os
import statistics
import sys
import threading
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor

WEATHER_TOOL = {
    "type": "function",
    "function": {
        "name": "get_weather",
        "description": "Current weather for a city.",
        "parameters": {
            "type": "object",
            "properties": {
                "city": {"type": "string", "description": "City name"},
                "unit": {"type": "string", "enum": ["celsius", "fahrenheit"]},
            },
            "required": ["city"],
        },
    },
}


class Client:
    def __init__(self, base: str, key: str, model: str):
        self.base = base.rstrip("/")
        self.key = key
        self.model = model

    def _request(self, body: dict) -> urllib.request.Request:
        body = {"model": self.model, **body}
        return urllib.request.Request(
            f"{self.base}/v1/chat/completions",
            data=json.dumps(body).encode(),
            headers={"content-type": "application/json", "authorization": f"Bearer {self.key}"},
            method="POST",
        )

    def complete(self, body: dict, timeout: float = 300) -> dict:
        t0 = time.perf_counter()
        with urllib.request.urlopen(self._request({**body, "stream": False}), timeout=timeout) as resp:
            data = json.load(resp)
        data["_latency_s"] = time.perf_counter() - t0
        return data

    def stream(self, body: dict, timeout: float = 300) -> dict:
        """Stream one completion; return the assembled message and its timings."""
        req = self._request({**body, "stream": True, "stream_options": {"include_usage": True}})
        t0 = time.perf_counter()
        first = None
        content = []
        calls: dict[int, dict] = {}
        usage = None
        finish = None
        chunks = 0
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            for raw in resp:
                line = raw.decode().strip()
                if not line.startswith("data:"):
                    continue
                payload = line[5:].strip()
                if payload == "[DONE]":
                    break
                event = json.loads(payload)
                if event.get("usage"):
                    usage = event["usage"]
                for choice in event.get("choices", []):
                    delta = choice.get("delta") or {}
                    if choice.get("finish_reason"):
                        finish = choice["finish_reason"]
                    if delta.get("content") or delta.get("tool_calls"):
                        chunks += 1
                        if first is None:
                            first = time.perf_counter()
                    if delta.get("content"):
                        content.append(delta["content"])
                    for tc in delta.get("tool_calls") or []:
                        slot = calls.setdefault(tc.get("index", 0), {"id": None, "name": "", "arguments": ""})
                        slot["id"] = tc.get("id") or slot["id"]
                        fn = tc.get("function") or {}
                        slot["name"] += fn.get("name") or ""
                        slot["arguments"] += fn.get("arguments") or ""
        end = time.perf_counter()
        out_tokens = (usage or {}).get("completion_tokens", 0)
        decode = end - first if first else None
        return {
            "content": "".join(content),
            "tool_calls": [calls[i] for i in sorted(calls)],
            "finish_reason": finish,
            "usage": usage,
            "chunks": chunks,
            "ttft_s": (first - t0) if first else None,
            "total_s": end - t0,
            "decode_tok_s": (out_tokens - 1) / decode if decode and out_tokens > 1 else None,
        }


def pct(values: list[float], p: float) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    k = min(len(ordered) - 1, max(0, round(p / 100 * (len(ordered) - 1))))
    return ordered[k]


def check_chat(c: Client) -> dict:
    r = c.complete({
        "messages": [
            {"role": "system", "content": "Answer in one short sentence."},
            {"role": "user", "content": "What is the capital of Norway?"},
        ],
        "max_tokens": 64,
        "temperature": 0,
    })
    msg = r["choices"][0]["message"]
    return {"content": msg.get("content"), "usage": r.get("usage"), "latency_s": r["_latency_s"], "ok": "oslo" in (msg.get("content") or "").lower()}


def check_stream(c: Client) -> dict:
    r = c.stream({
        "messages": [{"role": "user", "content": "Explain in about 200 words how a Cloud Run service scales to zero and what a cold start is."}],
        "max_tokens": 320,
        "temperature": 0,
    })
    r["ok"] = bool(r["content"]) and r["chunks"] > 5
    return r


def check_tools(c: Client) -> dict:
    ask = [
        {"role": "system", "content": "You are a helpful assistant. Use a tool when one fits."},
        {"role": "user", "content": "What's the weather in Oslo right now, in celsius?"},
    ]
    body = {"messages": ask, "tools": [WEATHER_TOOL], "max_tokens": 200, "temperature": 0}
    plain = c.complete(body)
    msg = plain["choices"][0]["message"]
    calls = msg.get("tool_calls") or []
    streamed = c.stream(body)
    result = {
        "non_stream": {
            "finish_reason": plain["choices"][0].get("finish_reason"),
            "content": msg.get("content"),
            "tool_calls": calls,
            "latency_s": plain["_latency_s"],
        },
        "stream": streamed,
    }
    called = bool(calls) and calls[0]["function"]["name"] == "get_weather" and "oslo" in calls[0]["function"]["arguments"].lower()
    stream_called = bool(streamed["tool_calls"]) and streamed["tool_calls"][0]["name"] == "get_weather" and streamed["finish_reason"] == "tool_calls"
    follow = None
    if called:
        turn = ask + [
            {"role": "assistant", "content": None, "tool_calls": calls},
            {"role": "tool", "tool_call_id": calls[0]["id"], "content": json.dumps({"city": "Oslo", "temperature_c": 4, "conditions": "light snow"})},
        ]
        f = c.complete({"messages": turn, "tools": [WEATHER_TOOL], "max_tokens": 120, "temperature": 0})
        text = f["choices"][0]["message"].get("content") or ""
        follow = {"content": text, "latency_s": f["_latency_s"], "ok": "4" in text and "snow" in text.lower()}
    result["follow_up"] = follow
    result["ok"] = called and stream_called and bool(follow and follow["ok"])
    return result


def task_body(task: dict) -> dict:
    body = {"messages": task["messages"], "max_tokens": task.get("max_tokens", 512), "temperature": task.get("temperature", 0)}
    if task.get("tools"):
        body["tools"] = task["tools"]
    return body


def run_load(c: Client, tasks: list[dict], levels: list[int]) -> list[dict]:
    """Stream the eval prompts at each concurrency level and time the whole batch."""
    out = []
    for level in levels:
        batch = [tasks[i % len(tasks)] for i in range(max(level * 3, 24))]
        results = []
        lock = threading.Lock()

        def one(task):
            try:
                r = c.stream(task_body(task))
            except (urllib.error.URLError, TimeoutError, ConnectionError) as err:
                r = {"error": str(err)}
            with lock:
                results.append(r)

        t0 = time.perf_counter()
        with ThreadPoolExecutor(max_workers=level) as pool:
            list(pool.map(one, batch))
        wall = time.perf_counter() - t0
        ok = [r for r in results if "error" not in r]
        out_tokens = sum((r.get("usage") or {}).get("completion_tokens", 0) for r in ok)
        in_tokens = sum((r.get("usage") or {}).get("prompt_tokens", 0) for r in ok)
        lat = [r["total_s"] for r in ok]
        ttft = [r["ttft_s"] for r in ok if r.get("ttft_s") is not None]
        out.append({
            "concurrency": level,
            "requests": len(batch),
            "errors": len(results) - len(ok),
            "wall_s": wall,
            "requests_per_s": len(ok) / wall,
            "output_tokens_per_s": out_tokens / wall,
            "mean_prompt_tokens": in_tokens / max(1, len(ok)),
            "mean_output_tokens": out_tokens / max(1, len(ok)),
            "latency_p50_s": pct(lat, 50),
            "latency_p95_s": pct(lat, 95),
            "ttft_p50_s": pct(ttft, 50),
            "ttft_p95_s": pct(ttft, 95),
        })
        print(json.dumps(out[-1]), flush=True)
    return out


def run_eval(c: Client, tasks: list[dict], workers: int) -> list[dict]:
    def one(task):
        try:
            r = c.complete(task_body(task))
            msg = r["choices"][0]["message"]
            return {
                "id": task["id"],
                "content": msg.get("content"),
                "tool_calls": [
                    {"name": tc["function"]["name"], "arguments": tc["function"]["arguments"]} for tc in (msg.get("tool_calls") or [])
                ],
                "finish_reason": r["choices"][0].get("finish_reason"),
                "usage": r.get("usage"),
                "latency_s": r["_latency_s"],
            }
        except urllib.error.HTTPError as err:
            return {"id": task["id"], "error": f"HTTP {err.code}: {err.read().decode()[:400]}"}
        except (urllib.error.URLError, TimeoutError, ConnectionError) as err:
            return {"id": task["id"], "error": str(err)}

    with ThreadPoolExecutor(max_workers=workers) as pool:
        return list(pool.map(one, tasks))


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--base", default="http://127.0.0.1:8080")
    ap.add_argument("--model", default=os.environ.get("SERVED_MODEL_NAME", "microsoft/Phi-4-mini-instruct"))
    ap.add_argument("--tasks", required=True, help="eval task JSON from scripts/phi-brain-eval.mjs build")
    ap.add_argument("--boot", help="JSON with container_start and health_ok epoch seconds")
    ap.add_argument("--levels", default="1,8,16,32")
    ap.add_argument("--out", required=True)
    args = ap.parse_args(argv)

    key = os.environ.get("VLLM_API_KEY", "")
    c = Client(args.base, key, args.model)
    tasks = json.load(open(args.tasks))["tasks"]
    report: dict = {"model": args.model, "revision": os.environ.get("PHI_REVISION"), "started_at": time.time()}
    if args.boot:
        boot = json.load(open(args.boot))
        boot["cold_start_s"] = boot["health_ok"] - boot["container_start"]
        report["boot"] = boot

    # First request after boot pays CUDA graph and cache warmup: time it apart.
    report["first_request"] = check_chat(c)
    report["chat"] = check_chat(c)
    report["stream"] = check_stream(c)
    report["tools"] = check_tools(c)
    print(json.dumps({k: report[k].get("ok") for k in ("chat", "stream", "tools")}), flush=True)
    report["load"] = run_load(c, tasks, [int(x) for x in args.levels.split(",")])
    report["eval"] = run_eval(c, tasks, workers=16)
    report["finished_at"] = time.time()
    with open(args.out, "w") as f:
        json.dump(report, f, indent=1)
    errors = sum(1 for e in report["eval"] if "error" in e)
    print(f"wrote {args.out}: {len(report['eval'])} eval answers, {errors} errors", flush=True)
    return 0 if report["chat"]["ok"] else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
