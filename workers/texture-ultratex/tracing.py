"""Cloud Trace server spans for a FastAPI worker. Stdlib only, fail-open.

Vendored byte-identical into every worker that uses it (see
scripts/check-vendored-workers.mjs). The API process (api/_lib/tracing.js) sends a
W3C ``traceparent`` header on every worker call; this module reads it, records one
SERVER span per request that joins the same trace, and exports it to Google Cloud
Trace over OTLP/HTTP JSON. A worker never starts a trace of its own: with no
inbound traceparent, or one whose sampled flag is off, nothing is recorded and no
network call is made, so a sampled-out request costs the worker one header parse.

Usage in a worker's main.py::

    from tracing import install_tracing, span
    install_tracing(app, "rembg")
    with span("matte"):
        ...

Environment: TRACE_PROJECT (default GOOGLE_CLOUD_PROJECT, then
aerial-vehicle-466722-p5), TRACE_ENDPOINT (default the Google Telemetry API).
Export failures are logged at most once a minute and never reach the request.
"""

import contextvars
import json
import os
import queue
import re
import secrets
import threading
import time
import urllib.error
import urllib.request

DEFAULT_PROJECT = "aerial-vehicle-466722-p5"
DEFAULT_ENDPOINT = "https://telemetry.googleapis.com/v1/traces"
METADATA_TOKEN_URL = (
    "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token"
)
FLUSH_SECONDS = 5.0
MAX_BATCH = 100
MAX_QUEUE = 2000
WARN_EVERY_SECONDS = 60.0

_TRACEPARENT = re.compile(r"^([0-9a-f]{2})-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$")

SPAN_KIND_INTERNAL = 1
SPAN_KIND_SERVER = 2

_current = contextvars.ContextVar("trace_span", default=None)


def parse_traceparent(value):
    """Return (trace_id, parent_span_id, sampled) or None for a bad header."""
    if not isinstance(value, str):
        return None
    m = _TRACEPARENT.match(value.strip().lower())
    if not m or m.group(1) == "ff":
        return None
    trace_id, span_id = m.group(2), m.group(3)
    if set(trace_id) == {"0"} or set(span_id) == {"0"}:
        return None
    return trace_id, span_id, (int(m.group(4), 16) & 1) == 1


def format_traceparent(trace_id, span_id, sampled):
    return "00-%s-%s-%s" % (trace_id, span_id, "01" if sampled else "00")


class Span:
    def __init__(self, name, kind, trace_id, parent_id, attrs=None):
        self.name = name
        self.kind = kind
        self.trace_id = trace_id
        self.span_id = secrets.token_hex(8)
        self.parent_id = parent_id
        self.attrs = dict(attrs or {})
        self.start_ns = time.time_ns()
        self.end_ns = None
        self.error = None

    def set_attribute(self, key, value):
        if value is not None:
            self.attrs[key] = value

    def record_error(self, err):
        self.error = str(err)[:300]

    def end(self):
        if self.end_ns is not None:
            return
        self.end_ns = time.time_ns()
        _enqueue(self)


class _Exporter:
    def __init__(self):
        self.queue = queue.Queue(maxsize=MAX_QUEUE)
        self.thread = None
        self.lock = threading.Lock()
        self.token = None
        self.token_expiry = 0.0
        self.last_warn = 0.0
        self.sender = None  # test hook: callable(payload_dict)
        self.threaded = True  # test hook: False leaves spans queued for an explicit flush

    def warn(self, message):
        now = time.time()
        if now - self.last_warn >= WARN_EVERY_SECONDS:
            self.last_warn = now
            print("[tracing] " + message, flush=True)

    def access_token(self):
        if self.token and time.time() < self.token_expiry - 60:
            return self.token
        req = urllib.request.Request(METADATA_TOKEN_URL, headers={"Metadata-Flavor": "Google"})
        with urllib.request.urlopen(req, timeout=2) as res:
            body = json.loads(res.read().decode("utf-8"))
        self.token = body["access_token"]
        self.token_expiry = time.time() + float(body.get("expires_in", 300))
        return self.token

    def send(self, payload):
        if self.sender is not None:
            self.sender(payload)
            return
        project = os.environ.get("TRACE_PROJECT") or os.environ.get("GOOGLE_CLOUD_PROJECT") or DEFAULT_PROJECT
        req = urllib.request.Request(
            os.environ.get("TRACE_ENDPOINT") or DEFAULT_ENDPOINT,
            data=json.dumps(payload).encode("utf-8"),
            method="POST",
            headers={
                "content-type": "application/json",
                "authorization": "Bearer " + self.access_token(),
                "x-goog-user-project": project,
            },
        )
        try:
            with urllib.request.urlopen(req, timeout=10):
                pass
        except urllib.error.HTTPError as err:
            # Google's error body names the cause (for a 403, the denied permission),
            # so carry it into the warning instead of a bare status line.
            try:
                detail = json.loads(err.read().decode("utf-8")).get("error", {}).get("message", "")
            except Exception:
                detail = ""
            raise RuntimeError("trace export http %d%s" % (err.code, ": " + str(detail)[:300] if detail else "")) from None

    def run(self):
        while True:
            batch = [self.queue.get()]
            deadline = time.time() + FLUSH_SECONDS
            while len(batch) < MAX_BATCH:
                remaining = deadline - time.time()
                if remaining <= 0:
                    break
                try:
                    batch.append(self.queue.get(timeout=remaining))
                except queue.Empty:
                    break
            self.flush(batch)

    def flush(self, batch):
        try:
            self.send(to_otlp(batch))
        except Exception as err:  # fail-open: tracing never breaks a request
            self.warn("export failed, dropped %d span(s): %s" % (len(batch), err))

    def ensure_thread(self):
        with self.lock:
            if self.thread is None:
                self.thread = threading.Thread(target=self.run, name="trace-export", daemon=True)
                self.thread.start()


_exporter = _Exporter()


def _enqueue(span):
    try:
        _exporter.queue.put_nowait(span)
    except queue.Full:
        return
    if _exporter.threaded:
        _exporter.ensure_thread()


def _attr_value(v):
    if isinstance(v, bool):
        return {"boolValue": v}
    if isinstance(v, int):
        return {"intValue": str(v)}
    if isinstance(v, float):
        return {"doubleValue": v}
    return {"stringValue": str(v)[:256]}


def to_otlp(spans):
    project = os.environ.get("TRACE_PROJECT") or os.environ.get("GOOGLE_CLOUD_PROJECT") or DEFAULT_PROJECT
    service = os.environ.get("K_SERVICE") or "worker"
    out = []
    for s in spans:
        item = {
            "traceId": s.trace_id,
            "spanId": s.span_id,
            "name": s.name,
            "kind": s.kind,
            "startTimeUnixNano": str(s.start_ns),
            "endTimeUnixNano": str(s.end_ns if s.end_ns is not None else time.time_ns()),
            "attributes": [{"key": k, "value": _attr_value(v)} for k, v in s.attrs.items()],
            "status": {"code": 2, "message": s.error} if s.error else {"code": 1},
        }
        if s.parent_id:
            item["parentSpanId"] = s.parent_id
        out.append(item)
    return {
        "resourceSpans": [
            {
                "resource": {
                    "attributes": [
                        {"key": "gcp.project_id", "value": {"stringValue": project}},
                        {"key": "service.name", "value": {"stringValue": service}},
                    ]
                },
                "scopeSpans": [{"scope": {"name": "three.ws/worker-tracing"}, "spans": out}],
            }
        ]
    }


def start_server_span(name, traceparent, attrs=None):
    """Return a recording Span joined to the inbound trace, or None when not sampled."""
    parsed = parse_traceparent(traceparent)
    if not parsed or not parsed[2]:
        return None
    return Span(name, SPAN_KIND_SERVER, parsed[0], parsed[1], attrs)


class span:
    """Context manager: a child span of the active request span, a no-op outside one."""

    def __init__(self, name, **attrs):
        self.name = name
        self.attrs = attrs
        self._span = None
        self._token = None

    def __enter__(self):
        parent = _current.get()
        if parent is None:
            return None
        self._span = Span(self.name, SPAN_KIND_INTERNAL, parent.trace_id, parent.span_id, self.attrs)
        self._token = _current.set(self._span)
        return self._span

    def __exit__(self, exc_type, exc, tb):
        if self._span is None:
            return False
        if exc is not None:
            self._span.record_error(exc)
        _current.reset(self._token)
        self._span.end()
        return False


class TraceMiddleware:
    """Pure ASGI middleware, so streaming responses are not buffered."""

    def __init__(self, app, service="worker"):
        self.app = app
        self.service = service

    async def __call__(self, scope, receive, send):
        if scope.get("type") != "http":
            return await self.app(scope, receive, send)
        header = None
        for key, value in scope.get("headers") or []:
            if key == b"traceparent":
                header = value.decode("latin-1")
                break
        path = scope.get("path", "")
        srv = start_server_span(
            "%s %s" % (scope.get("method", "GET"), path),
            header,
            {"http.request.method": scope.get("method", "GET"), "http.route": path, "service.name": self.service},
        )
        if srv is None:
            return await self.app(scope, receive, send)
        token = _current.set(srv)
        status = {"code": None}

        async def wrapped_send(message):
            if message.get("type") == "http.response.start":
                status["code"] = message.get("status")
            await send(message)

        try:
            await self.app(scope, receive, wrapped_send)
        except Exception as err:
            srv.record_error(err)
            raise
        finally:
            _current.reset(token)
            srv.set_attribute("http.response.status_code", status["code"])
            if status["code"] is not None and status["code"] >= 500:
                srv.record_error("http %s" % status["code"])
            srv.end()


def install_tracing(app, service):
    """Attach the middleware to a FastAPI/Starlette app."""
    app.add_middleware(TraceMiddleware, service=service)
