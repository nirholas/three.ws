"""A MetaGPT studio team that finds or makes a 3D model through three.ws and checks it.

Three MetaGPT roles, each with its own Action, pass messages through a Team:

    ArtDirector  one-line brief -> model spec + catalog search query   (Grok)
    Modeler      search_catalog, then forge_free + check_job if signed in and nothing fits
    Reviewer     renders the GLB, judges it against the spec           (Grok, with the images)

A failed review sends the fault back to the Art Director, who rewrites the spec
once. At most two iterations, whatever the result. Grok is the LLM through
xAI's OpenAI-compatible endpoint.

    XAI_API_KEY=... python main.py
    XAI_API_KEY=... python main.py "a brass desk lamp"
    python main.py --check     three.ws leg only: list tools, search the catalog, render (no xAI key)

Keys are read from the environment only and are never printed or written.
"""

from __future__ import annotations

import base64
import json
import os
import re
import shutil
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid

MCP_URL = os.environ.get("THREE_WS_MCP_URL", "https://three.ws/api/mcp-studio")
XAI_BASE_URL = os.environ.get("XAI_BASE_URL", "https://api.x.ai/v1")
MODEL = os.environ.get("XAI_MODEL", "grok-4.7")
REQUIRED_TOOLS = ["search_catalog", "look_at_model", "forge_free", "check_job"]
DEFAULT_BRIEF = "a low-poly wooden chair for a cozy cabin scene"
MAX_ITERATIONS = 2
MAX_ROUNDS = 9  # Team.run cap: 3 roles x 2 iterations plus the Art Director's first pass
FORGE_WAIT_S = 900  # one generation; a free-lane model took about five minutes on 2026-11-27
FORGE_ATTEMPTS = 3  # generations started before giving up, when the server says to start again
EXIT_OK, EXIT_FAILED, EXIT_NO_KEY, EXIT_REVIEW_FAILED = 0, 1, 2, 3


def xai_key() -> str | None:
    return os.environ.get("XAI_API_KEY") or os.environ.get("GROK_API_KEY")


def viewer_url(glb: str, title: str = "") -> str:
    query = {"src": glb}
    if title:
        query["title"] = title
    return "https://three.ws/viewer?" + urllib.parse.urlencode(query, quote_via=urllib.parse.quote)


def poster_url(glb: str, size: int = 512) -> str:
    query = {"glbUrl": glb, "width": size, "height": size}
    return "https://three.ws/api/render/glb?" + urllib.parse.urlencode(query, quote_via=urllib.parse.quote)


class StudioError(RuntimeError):
    """three.ws refused a call. The message is the server's own sentence; `data` holds
    its fields (`reason`, `retry_after`, ...), e.g. `rate_limited` when an account's
    hourly generation budget is used up."""

    def __init__(self, message: str, data: dict | None = None) -> None:
        super().__init__(message)
        self.data = data or {}


def fault_text(err: BaseException) -> str:
    """One line for a failure. MetaGPT re-raises a role's exception with the whole
    stack trace as its message; the last line of that trace is the real error."""
    if isinstance(err, StudioError):
        return str(err)
    text = str(err)
    if text.startswith("Traceback (most recent call last)"):
        return text.strip().splitlines()[-1].strip()
    return f"{type(err).__name__}: {text}"


# The three.ws leg, spoken directly: MCP JSON-RPC over plain HTTP POST.
class Studio:
    """A session with the three.ws studio server. The key is optional: catalog search
    is public, rendering views and generating need a free account key."""

    def __init__(self) -> None:
        self.key = os.environ.get("THREE_WS_API_KEY")
        self.session: str | None = None
        self.tool_names: list[str] = []
        self._ids = 0

    @property
    def signed_in(self) -> bool:
        return bool(self.key)

    def rpc(self, method: str, params: dict) -> dict:
        self._ids += 1
        headers = {"content-type": "application/json", "accept": "application/json, text/event-stream"}
        if self.session:
            headers["mcp-session-id"] = self.session
        if self.key:
            headers["authorization"] = f"Bearer {self.key}"
        body = json.dumps({"jsonrpc": "2.0", "id": self._ids, "method": method, "params": params}).encode()
        req = urllib.request.Request(MCP_URL, data=body, headers=headers, method="POST")
        try:
            with urllib.request.urlopen(req, timeout=75) as res:
                self.session = res.headers.get("mcp-session-id") or self.session
                payload = json.loads(res.read().decode())
        except urllib.error.HTTPError as err:
            raise RuntimeError(f"{MCP_URL} answered HTTP {err.code} to {method}: {err.read()[:300]!r}") from err
        if "error" in payload:
            error = payload["error"] if isinstance(payload["error"], dict) else {"message": str(payload["error"])}
            raise StudioError(f"three.ws refused {method}: {error.get('message') or 'no reason given'}", error.get("data"))
        return payload["result"]

    def connect(self) -> str:
        init = self.rpc(
            "initialize",
            {"protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": "metagpt-3d-studio-example", "version": "1.0.0"}},
        )
        self.tool_names = [t["name"] for t in self.rpc("tools/list", {})["tools"]]
        return init["serverInfo"]["name"]

    def call(self, name: str, arguments: dict) -> dict:
        """Returns the tool result: `structuredContent` plus the raw `content` blocks."""
        result = self.rpc("tools/call", {"name": name, "arguments": arguments})
        return {"data": result.get("structuredContent") or {}, "content": result.get("content", []), "is_error": bool(result.get("isError"))}

    def search(self, query: str, kind: str | None = None, limit: int = 8) -> list[dict]:
        args: dict = {"q": query, "limit": limit}
        if kind in ("object", "character"):
            args["kind"] = kind
        return self.call("search_catalog", args)["data"].get("items", [])

    def look(self, glb: str, views: list[str], size: int = 384) -> dict:
        return self.call("look_at_model", {"glb_url": glb, "views": views, "size": size})

    def forge(self, prompt: str) -> dict:
        """forge_free, then check_job until the model is done. Needs a signed-in key.

        A busy generator answers `reason: generation_failed` and asks for a new
        generation under a new idempotency_key (the same key replays the failed
        job), so that is what happens, up to FORGE_ATTEMPTS generations inside one
        FORGE_WAIT_S budget. Any other failure is returned as it is: starting again
        does not fix a missing sign-in or a spent quota.
        """
        deadline = time.time() + FORGE_WAIT_S
        out: dict = {}
        for attempt in range(1, FORGE_ATTEMPTS + 1):
            out = self.call("forge_free", {"prompt": prompt, "tier": "standard", "idempotency_key": f"metagpt-{uuid.uuid4().hex}"})
            while time.time() < deadline:
                data = out["data"]
                if data.get("status") == "pending" and data.get("job_id"):
                    wait = data.get("eta_seconds") or 15
                elif data.get("retryable") and data.get("job_id"):
                    # Only this status check failed; the job itself is still running.
                    wait = data.get("retry_after") or 10
                else:
                    break
                time.sleep(min(max(int(wait), 5), 30))
                out = self.call("check_job", {"job_id": data["job_id"]})
            if out["data"].get("reason") != "generation_failed" or attempt == FORGE_ATTEMPTS or time.time() >= deadline:
                break
            time.sleep(5)
        return out


def forge_fault(made: dict) -> str:
    """Why a generation produced no model, in the server's words where it gave any."""
    data = made["data"]
    if data.get("status") == "pending":
        return f"job {data.get('job_id')} was still rendering after {FORGE_WAIT_S}s (check_job collects it later)"
    text = next((block.get("text") for block in made["content"] if block.get("text")), None)
    return data.get("message") or text or data.get("status") or "the server gave no reason"


def fetch_png(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"user-agent": "metagpt-3d-studio-example/1.0"})
    with urllib.request.urlopen(req, timeout=90) as res:
        body = res.read()
    if not body.startswith(b"\x89PNG"):
        raise RuntimeError(f"{url} did not return a PNG")
    return body


def xai_preflight(key: str) -> None:
    """One authenticated read against xAI before the team starts. MetaGPT retries every failed
    call six times with backoff, so a wrong key would otherwise burn a minute in retries."""
    req = urllib.request.Request(f"{XAI_BASE_URL}/models", headers={"authorization": f"Bearer {key}", "user-agent": "metagpt-3d-studio-example/1.0"})
    try:
        urllib.request.urlopen(req, timeout=30).read()
    except urllib.error.HTTPError as err:
        try:
            detail = json.loads(err.read().decode()).get("error", "")
        except ValueError:
            detail = ""
        raise RuntimeError(f"xAI answered HTTP {err.code}: {detail}") from err


def check() -> int:
    studio = Studio()
    server = studio.connect()
    missing = [n for n in REQUIRED_TOOLS if n not in studio.tool_names]
    print(f"server   {server} ({MCP_URL})")
    print(f"tools    {len(studio.tool_names)} offered; this example uses {', '.join(REQUIRED_TOOLS)}")
    print(f"account  {'THREE_WS_API_KEY set: renders and generation are available' if studio.signed_in else 'signed out: catalog search and poster renders only'}")
    if missing:
        print(f"error    the server does not offer: {', '.join(missing)}", file=sys.stderr)
        return EXIT_FAILED
    items = studio.search("chair", "object", 3)
    if not items:
        print("error    search_catalog returned no chairs", file=sys.stderr)
        return EXIT_FAILED
    for item in items:
        print(f"catalog  {item['title']}  {item['url']}")
    glb = items[0]["url"]
    looked = studio.look(glb, ["front", "side"], 256)
    frames = [c for c in looked["content"] if c.get("type") == "image"]
    if looked["is_error"]:
        reason = looked["data"].get("status", "error")
        print(f"render   look_at_model on {items[0]['title']}: {reason}, so the Reviewer falls back to the public poster render")
        png = fetch_png(poster_url(glb, 512))
        print(f"render   poster render of {items[0]['title']}: PNG, {len(png)} bytes")
    else:
        print(f"render   look_at_model on {items[0]['title']}: {len(frames)} frames")
        for block in looked["content"]:
            if block.get("type") == "text":
                print(f"render   {block['text'][:300]}")
    print("ok       three.ws leg is live")
    return EXIT_OK


# ---------------------------------------------------------------------------
# The MetaGPT team. Everything MetaGPT writes (logs, workspace) goes to a temp
# folder that is removed on exit; the key is passed in memory, never to a file.
# ---------------------------------------------------------------------------

class Run:
    """What the team agrees on while it works, and what main() prints at the end."""

    def __init__(self, studio: Studio) -> None:
        self.studio = studio
        self.iteration = 0
        self.llm_calls = 0
        self.done = False
        self.rejected: list[str] = []
        self.final: dict | None = None
        self.delivered: dict | None = None  # the latest review of a model that exists
        self.error: str | None = None


RUN: Run | None = None


def parse_json(text: str) -> dict:
    match = re.search(r"\{.*\}", text, re.DOTALL)
    if not match:
        raise ValueError(f"Grok did not answer with JSON: {text[:200]!r}")
    return json.loads(match.group(0))


def build_team(brief: str):
    import contextlib
    import io

    with contextlib.redirect_stderr(io.StringIO()):  # MetaGPT logs at INFO while it imports
        from metagpt.actions import Action, UserRequirement
        from metagpt.config2 import Config
        from metagpt.logs import logger
        from metagpt.roles import Role
        from metagpt.schema import Message
        from metagpt.team import Team
        from metagpt.utils.common import any_to_str

    config = Config.from_llm_config(
        {
            "api_type": "openai",  # xAI speaks the OpenAI chat-completions protocol
            "base_url": XAI_BASE_URL,
            "api_key": xai_key(),
            "model": MODEL,
            "temperature": 0.2,
            "stream": False,
            "calc_usage": False,  # MetaGPT has no price for Grok ids; the call count is the cap
        }
    )

    async def ask(action: Action, prompt: str, images: list[bytes] | None = None) -> str:
        RUN.llm_calls += 1
        try:
            if not images:
                return await action.llm.aask(prompt)
            message = action.llm._user_msg_with_imgs(prompt, [base64.b64encode(i).decode() for i in images])
            return await action.llm.acompletion_text([message])
        except Exception as err:  # MetaGPT's Team swallows role errors: keep the first one to report it
            RUN.error = RUN.error or f"xAI call failed: {getattr(err, 'message', err)}"
            raise

    async def ask_json(action: Action, prompt: str, images: list[bytes] | None = None) -> dict:
        reply = await ask(action, prompt, images)
        try:
            return parse_json(reply)
        except ValueError:
            return parse_json(await ask(action, prompt + "\n\nAnswer with one JSON object and nothing else.", images))

    class WriteSpec(Action):
        name: str = "WriteSpec"

        async def run(self, brief: str, review: dict | None = None) -> dict:
            if review is None:
                prompt = (
                    "You are the Art Director of a small 3D studio. Turn this one-line brief into a precise model spec "
                    f"and a catalog search query.\n\nBrief: {brief}\n\n"
                )
            else:
                prompt = (
                    "You are the Art Director of a small 3D studio. Your first model failed review.\n\n"
                    f"Brief: {brief}\nPrevious spec: {json.dumps(review['spec'])}\n"
                    f"Reviewer's fault: {review['fault']}\nAlready rejected GLBs: {json.dumps(RUN.rejected)}\n\n"
                    "Rewrite the spec and the search query so the next model avoids that fault.\n\n"
                )
            prompt += (
                "Answer with one JSON object and nothing else, with these keys:\n"
                '  "subject": one noun phrase for the object,\n'
                '  "kind": "object" or "character" (a humanoid that should move is a character),\n'
                '  "must_have": list of 3 to 5 short, checkable features (parts, proportions, material, style),\n'
                '  "must_not": list of 1 to 3 faults to reject,\n'
                '  "query": a 1 or 2 word catalog search query (every word must match, so keep it broad),\n'
                '  "forge_prompt": one sentence for a text-to-3D generator: one subject, its material and style, no scene or background.'
            )
            spec = await ask_json(self, prompt)
            spec["iteration"] = RUN.iteration + 1
            return spec

    class Source(Action):
        name: str = "Source"

        async def run(self, spec: dict) -> dict:
            studio = RUN.studio
            items = [i for i in studio.search(spec["query"], spec.get("kind")) if i["url"] not in RUN.rejected]
            if len(items) == 0 and " " in spec["query"]:
                items = [i for i in studio.search(spec["query"].split()[-1], spec.get("kind")) if i["url"] not in RUN.rejected]
            chosen = None
            if items:
                listing = "\n".join(
                    f"{n}. {i['title']} | {i.get('license', '')} | tags: {', '.join(i.get('tags', [])[:8])}" for n, i in enumerate(items, 1)
                )
                verdict = await ask_json(
                    self,
                    "You are the Modeler of a 3D studio. Pick the catalog asset closest to this spec, judging from titles and tags, "
                    "and say whether it is close enough to ship.\n\n"
                    f"Spec: {json.dumps({k: spec[k] for k in ('subject', 'must_have', 'must_not')})}\n\nCandidates:\n{listing}\n\n"
                    'Answer with one JSON object: {"pick": <number>, "close_enough": true|false, "why": "<one sentence>"}',
                )
                if isinstance(verdict.get("pick"), int) and 1 <= verdict["pick"] <= len(items):
                    closest = {**items[verdict["pick"] - 1], "source": "catalog", "why": verdict.get("why", "")}
                    # Signed in, a poor fit is made instead; signed out, the closest goes to review as it is.
                    if verdict.get("close_enough") or not studio.signed_in:
                        chosen = closest
            if chosen is None and studio.signed_in:
                made = studio.forge(spec["forge_prompt"])
                data = made["data"]
                if data.get("status") == "done" and data.get("glb_url"):
                    chosen = {
                        "title": spec["subject"],
                        "url": data["glb_url"],
                        "viewer_url": data.get("viewer_url") or viewer_url(data["glb_url"], spec["subject"]),
                        "source": "forge_free",
                        "why": "nothing in the catalog fit, so it was generated",
                    }
                else:
                    return {"error": f"forge_free did not finish: {forge_fault(made)}"}
            if chosen is None:
                return {"error": f"the free catalog has nothing for '{spec['query']}', and generation needs a free THREE_WS_API_KEY (https://three.ws/dashboard/api-keys)"}
            chosen["viewer_url"] = chosen.get("viewer_url") or viewer_url(chosen["url"], chosen["title"])
            return {"model": chosen, "spec": spec}

    class Review(Action):
        name: str = "Review"

        async def run(self, spec: dict, model: dict | None, error: str | None) -> dict:
            RUN.iteration += 1
            if model is None:
                return {"pass": False, "fault": error, "points": {}, "spec": spec, "model": None}
            studio = RUN.studio
            frames: list[bytes] = []
            facts = f"Catalog entry: {model['title']}; tags: {', '.join(model.get('tags', [])[:10])}; license: {model.get('license', 'n/a')}."
            how = "poster render (one three-quarter view)"
            if studio.signed_in:
                looked = studio.look(model["url"], ["three-quarter", "front", "side", "back"])
                if not looked["is_error"]:
                    frames = [base64.b64decode(c["data"]) for c in looked["content"] if c.get("type") == "image"]
                    facts = " ".join(c["text"] for c in looked["content"] if c.get("type") == "text")[:1500]
                    how = f"look_at_model ({len(frames)} views: three-quarter, front, side, back)"
            if not frames:
                frames = [fetch_png(poster_url(model["url"], 512))]
            print(f"render   {how}", flush=True)
            verdict = await ask_json(
                self,
                "You are the Reviewer of a 3D studio. Judge the attached render(s) of a 3D model against its spec, like an art director. "
                "Be strict and specific.\n\n"
                f"Spec: {json.dumps({k: spec[k] for k in ('subject', 'must_have', 'must_not')})}\n"
                f"Model facts: {facts}\nRendered with: {how}\n\n"
                "Judge four points, one sentence each: subject (is it the thing asked for, complete), shape (anything melted, fused, "
                "floating, or missing), material (does it read as the material asked for), geometry (use the facts; flag a triangle "
                "count far too high for a prop, or missing textures). If you only have one view, say what you could not check.\n"
                'Answer with one JSON object: {"pass": true|false, "fault": "<the specific fault, or empty if pass>", '
                '"points": {"subject": "...", "shape": "...", "material": "...", "geometry": "..."}}',
                frames,
            )
            verdict.update({"spec": spec, "model": model, "views": how})
            return verdict

    def finish(review: dict) -> None:
        RUN.done = True
        RUN.final = review

    class Guard(Role):
        """Stops a role once the review is final, so no role starts a third iteration."""

        async def _observe(self) -> int:
            news = await super()._observe()
            return 0 if RUN.done else news

        async def _act(self) -> Message:
            # Caught here, inside MetaGPT's own wrapper around Role.run: that wrapper logs a
            # stack trace and re-raises the trace as the message. One role failing ends the run.
            try:
                return await self.work()
            except Exception as err:
                RUN.error = RUN.error or f"{self.profile} failed: {fault_text(err)}"
                RUN.done = True
                return Message(content="{}", role=self.profile, cause_by="metagpt_3d_studio.Stopped")

        async def run(self, with_message=None):
            try:
                return await super().run(with_message)
            except Exception as err:  # MetaGPT's Team would swallow this and report "out of rounds"
                RUN.error = RUN.error or f"{self.profile} failed: {fault_text(err)}"
                RUN.done = True
                return None

    class ArtDirector(Guard):
        name: str = "Ada"
        profile: str = "ArtDirector"
        goal: str = "turn a one-line brief into a precise model spec and a catalog query"
        constraints: str = "never ask for a third iteration"

        def __init__(self, **kwargs):
            super().__init__(**kwargs)
            self.set_actions([WriteSpec])
            self._watch([UserRequirement, Review])

        async def work(self) -> Message:
            last = self.rc.news[-1]
            review = json.loads(last.content) if last.cause_by == any_to_str(Review) else None
            print(f"role     {self.profile} writes the spec" if review is None else f"role     {self.profile} rewrites the spec after: {review['fault']}", flush=True)
            spec = await self.rc.todo.run(brief, review)
            print(f"spec     {spec['subject']} | query '{spec['query']}' | kind {spec.get('kind')}", flush=True)
            return Message(content=json.dumps(spec), role=self.profile, cause_by=WriteSpec)

    class Modeler(Guard):
        name: str = "Milo"
        profile: str = "Modeler"
        goal: str = "find the right model in the free catalog, or generate one when signed in"
        constraints: str = "search the catalog first"

        def __init__(self, **kwargs):
            super().__init__(**kwargs)
            self.set_actions([Source])
            self._watch([WriteSpec])

        async def work(self) -> Message:
            spec = json.loads(self.rc.news[-1].content)
            print(f"role     {self.profile} searches the catalog for '{spec['query']}'", flush=True)
            out = await self.rc.todo.run(spec)
            if "model" in out:
                print(f"model    {out['model']['title']} via {out['model']['source']}: {out['model']['why']}", flush=True)
                RUN.rejected.append(out["model"]["url"])
            else:
                print(f"model    none: {out['error']}", flush=True)
            out.setdefault("spec", spec)
            out.setdefault("model", None)
            out.setdefault("error", None)
            return Message(content=json.dumps(out), role=self.profile, cause_by=Source)

    class Reviewer(Guard):
        name: str = "Rae"
        profile: str = "Reviewer"
        goal: str = "render the chosen model and judge it against the spec"
        constraints: str = "name the specific fault"

        def __init__(self, **kwargs):
            super().__init__(**kwargs)
            self.set_actions([Review])
            self._watch([Source])

        async def work(self) -> Message:
            sourced = json.loads(self.rc.news[-1].content)
            print(f"role     {self.profile} reviews iteration {RUN.iteration + 1} of {MAX_ITERATIONS}", flush=True)
            review = await self.rc.todo.run(sourced["spec"], sourced["model"], sourced.get("error"))
            print(f"review   {'PASS' if review['pass'] else 'FAIL'}{'' if review['pass'] else ': ' + str(review['fault'])}", flush=True)
            if review.get("model"):
                RUN.delivered = review
            if review["pass"] or RUN.iteration >= MAX_ITERATIONS:
                finish(review)
            return Message(content=json.dumps(review), role=self.profile, cause_by=Review)

    logger.remove()
    logger.add(sys.stderr, level="WARNING")
    team = Team(use_mgx=False)
    team.hire([ArtDirector(config=config), Modeler(config=config), Reviewer(config=config)])
    team.invest(1.0)
    return team


def report(run: Run) -> int:
    """Print how the run ended and return its exit code. A model that an earlier
    iteration made and reviewed is still delivered when a later one makes none."""
    final = run.final
    stopped = None
    if final is None or final.get("model") is None:
        stopped = run.error or (final or {}).get("fault") or "the team ran out of rounds before a review"
        final = run.delivered
        if final is None:
            print(f"error    no model delivered: {stopped}", file=sys.stderr)
            return EXIT_FAILED
        print(f"error    the run stopped early, so the last reviewed model is delivered: {stopped}", file=sys.stderr)
    model = final["model"]
    print(f"\nverdict  {'PASS' if final['pass'] else 'FAIL'} after {run.iteration} of {MAX_ITERATIONS} iterations ({run.llm_calls} Grok calls)")
    for point, text in (final.get("points") or {}).items():
        print(f"  {point:<9}{text}")
    if not final["pass"]:
        print(f"  fault    {final['fault']}")
    print(f"\nGLB:     {model['url']}\nViewer:  {model['viewer_url']}\nPoster:  {poster_url(model['url'], 1024)}")
    if stopped is None and final["pass"]:
        return EXIT_OK
    return EXIT_REVIEW_FAILED if not final["pass"] else EXIT_FAILED


def run(brief: str) -> int:
    global RUN
    if not xai_key():
        print("error    set XAI_API_KEY (create one at https://console.x.ai), or run with --check", file=sys.stderr)
        return EXIT_NO_KEY
    xai_preflight(xai_key())
    studio = Studio()
    studio.connect()
    RUN = Run(studio)
    if not studio.signed_in:
        print(
            "note     THREE_WS_API_KEY is not set: the team searches the free catalog and reviews a poster render; "
            "views and generation need a free key from https://three.ws/dashboard/api-keys",
            file=sys.stderr,
        )
    import asyncio

    team = build_team(brief)
    asyncio.run(team.run(n_round=MAX_ROUNDS, idea=brief))
    return report(RUN)


def main(argv: list[str]) -> int:
    flags = {a for a in argv if a.startswith("--")}
    words = [a for a in argv if not a.startswith("--")]
    scratch = tempfile.mkdtemp(prefix="metagpt-3d-studio-")
    # MetaGPT writes logs/ and workspace/ under its project root: keep that out of the repo.
    os.environ["METAGPT_PROJECT_ROOT"] = scratch
    # MetaGPT builds a default Config when it is imported and insists on an `llm` section.
    # Give it the endpoint and model only; the key is passed to the roles in memory.
    os.makedirs(os.path.join(scratch, "config"))
    with open(os.path.join(scratch, "config", "config2.yaml"), "w") as handle:
        json.dump({"llm": {"api_type": "openai", "base_url": XAI_BASE_URL, "model": MODEL}}, handle)
    try:
        if "--check" in flags:
            return check()
        return run(" ".join(words) or DEFAULT_BRIEF)
    except Exception as err:  # the network boundary: report, never a stack trace
        status = getattr(err, "status_code", None)
        if status is not None:
            print(f"error    xAI answered HTTP {status}: {getattr(err, 'message', err)}", file=sys.stderr)
        else:
            print(f"error    {type(err).__name__}: {err}", file=sys.stderr)
        return EXIT_FAILED
    finally:
        shutil.rmtree(scratch, ignore_errors=True)


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
