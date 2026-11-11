"""Phi-4-mini tool-call wire format: parse it whole or as it streams.

Phi-4-mini-instruct emits function calls as a JSON array wrapped in its
(non-special, so they survive detokenization) tool-call tokens:

    <|tool_call|>[{"name": "get_weather", "arguments": {"city": "Oslo"}}]<|/tool_call|>

Depending on the prompt it also writes the vLLM example template's
`functools[...]` form, or a bare `[{...}]` array. This module accepts all three,
reads `arguments` or `parameters` (object or JSON-encoded string), and keeps
nested arrays inside arguments intact (vLLM's stock phi4_mini_json regex is
non-greedy and cuts them off).

No vLLM imports: phi_tool_parser.py wraps this for the server, and
test_phi_tool_format.py exercises it without a GPU.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field

MARKERS = ("<|tool_call|>", "functools")
END_MARKER = "<|/tool_call|>"

INCOMPLETE = "incomplete"
INVALID = "invalid"


def _arguments(raw: dict) -> str:
    args = raw.get("arguments", raw.get("parameters", {}))
    if isinstance(args, str):
        try:
            args = json.loads(args) if args.strip() else {}
        except json.JSONDecodeError:
            return args
    return json.dumps(args if args is not None else {}, ensure_ascii=False)


def _calls_from(value, tool_names: set[str] | None) -> list[dict] | None:
    items = value if isinstance(value, list) else [value]
    if not items:
        return None
    calls = []
    for item in items:
        if not isinstance(item, dict) or not isinstance(item.get("name"), str) or not item["name"]:
            return None
        if tool_names is not None and item["name"] not in tool_names:
            return None
        calls.append({"name": item["name"], "arguments": _arguments(item)})
    return calls


def _closing_index(s: str) -> int | None:
    """Index of the bracket that closes the JSON value opening at s[0].

    None while the value is still open (the model is mid-call), -1 for a
    mismatched bracket. Brackets inside strings do not count.
    """
    pairs = {"[": "]", "{": "}"}
    stack: list[str] = []
    in_string = escaped = False
    for i, ch in enumerate(s):
        if in_string:
            if escaped:
                escaped = False
            elif ch == "\\":
                escaped = True
            elif ch == '"':
                in_string = False
        elif ch == '"':
            in_string = True
        elif ch in pairs:
            stack.append(pairs[ch])
        elif ch in "]}":
            if not stack or stack.pop() != ch:
                return -1
            if not stack:
                return i
    return None


def parse_calls(text: str, tool_names: set[str] | None = None):
    """Decode a tool-call block at the start of `text`.

    Returns a list of {"name", "arguments" (JSON string)} when the block is
    complete, INCOMPLETE when more tokens could still finish it, or INVALID when
    it can never be a tool call. A bare array (no marker) only counts when every
    name is one of `tool_names`, so a JSON answer to a plain question is never
    mistaken for a call.
    """
    s = text.lstrip()
    has_marker = False
    for marker in MARKERS:
        if s.startswith(marker):
            s = s[len(marker):].lstrip()
            has_marker = True
            break
    if not s:
        return INCOMPLETE
    if s[0] not in "[{":
        return INVALID
    end = _closing_index(s)
    if end is None:
        return INCOMPLETE
    if end < 0:
        return INVALID
    try:
        value = json.loads(s[: end + 1])
    except json.JSONDecodeError:
        return INVALID
    calls = _calls_from(value, None if has_marker else tool_names)
    return calls if calls else INVALID


def classify_prefix(text: str) -> str:
    """'tool', 'content' or 'maybe' for the first characters of a reply."""
    s = text.lstrip()
    if not s:
        return "maybe"
    for marker in MARKERS:
        if s.startswith(marker):
            return "tool"
        if marker.startswith(s):
            return "maybe"
    if s.startswith("["):
        rest = s[1:].lstrip()
        if not rest:
            return "maybe"
        return "tool" if rest.startswith("{") else "content"
    return "content"


def extract(model_output: str, tool_names: set[str] | None) -> tuple[str | None, list[dict]]:
    """Split a finished reply into (content, calls) for a non-streamed response."""
    starts = [model_output.find(m) for m in MARKERS if m in model_output]
    if starts:
        at = min(starts)
        calls = parse_calls(model_output[at:], tool_names)
        if isinstance(calls, list):
            before = model_output[:at].strip()
            return (before or None), calls
        return model_output, []
    if tool_names and classify_prefix(model_output) == "tool":
        calls = parse_calls(model_output, tool_names)
        if isinstance(calls, list):
            return None, calls
    return model_output, []


@dataclass
class StreamState:
    """Incremental splitter. feed() each delta, finish() once at the end.

    Plain answers stream through untouched; a tool-call block is held until its
    JSON closes, then released as whole calls. Nothing is ever dropped: a
    buffered prefix that turns out not to be a call comes back as content.
    """

    tool_names: set[str] | None
    mode: str = "maybe"
    buf: str = ""
    calls: list[dict] = field(default_factory=list)

    def feed(self, delta: str) -> tuple[str | None, list[dict]]:
        if self.mode == "content":
            return (delta or None), []
        if self.mode == "done":
            # Whatever trails the closed block (the end marker, whitespace).
            return None, []
        self.buf += delta
        if self.mode == "maybe":
            kind = classify_prefix(self.buf)
            if kind == "maybe":
                return None, []
            if kind == "content":
                return self._flush_content()
            self.mode = "tool"
        result = parse_calls(self.buf, self.tool_names)
        if result == INCOMPLETE:
            return None, []
        if result == INVALID:
            return self._flush_content()
        self.mode = "done"
        self.buf = ""
        self.calls = result
        return None, result

    def finish(self) -> tuple[str | None, list[dict]]:
        if self.mode not in ("maybe", "tool") or not self.buf:
            return None, []
        content, calls = extract(self.buf, self.tool_names)
        self.buf = ""
        if calls:
            self.mode = "done"
            self.calls = calls
            return content, calls
        self.mode = "content"
        return (content or None), []

    def _flush_content(self) -> tuple[str | None, list[dict]]:
        self.mode = "content"
        out, self.buf = self.buf, ""
        return (out or None), []
