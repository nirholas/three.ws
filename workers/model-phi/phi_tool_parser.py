"""vLLM tool parser `phi4_mini_native`: Phi-4-mini tool calls, streamed or not.

Loaded with `--tool-parser-plugin /app/phi_tool_parser.py --tool-call-parser
phi4_mini_native`. Replaces vLLM v0.29.0's stock `phi4_mini_json`, whose
streaming method returns None (a streamed request with tools emits no deltas
at all) and whose non-greedy regex truncates arguments that contain arrays.
The format logic lives in phi_tool_format.py so it is tested without a GPU.

`engine_based_streaming = True` makes vLLM hand this parser only the new delta
each step and call finish_streaming() once the generation ends, so a buffered
prefix that never became a call is released as content instead of lost.
"""

from __future__ import annotations

import os
import sys
from collections.abc import Sequence

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from phi_tool_format import StreamState, extract  # noqa: E402
from vllm.entrypoints.chat_utils import make_tool_call_id  # noqa: E402
from vllm.entrypoints.generate.base.protocol import (  # noqa: E402
    DeltaFunctionCall,
    DeltaMessage,
    DeltaToolCall,
    ExtractedToolCallInformation,
    FunctionCall,
    ToolCall,
)
from vllm.tool_parsers.abstract_tool_parser import ToolParser, ToolParserManager  # noqa: E402


def _tool_names(request) -> set[str] | None:
    tools = getattr(request, "tools", None) or []
    names = set()
    for tool in tools:
        fn = getattr(tool, "function", None)
        name = getattr(fn, "name", None) if fn is not None else None
        if name:
            names.add(name)
    return names or None


@ToolParserManager.register_module("phi4_mini_native")
class Phi4MiniNativeToolParser(ToolParser):
    engine_based_streaming = True

    def __init__(self, tokenizer, tools=None) -> None:
        super().__init__(tokenizer, tools)
        self.prev_tool_call_arr = []
        self.streamed_args_for_tool = []
        self.current_tool_id = -1
        self._state: StreamState | None = None

    def extract_tool_calls(self, model_output: str, request) -> ExtractedToolCallInformation:
        names = _tool_names(request)
        if names is None:
            return ExtractedToolCallInformation(tools_called=False, tool_calls=[], content=model_output)
        content, calls = extract(model_output, names)
        if not calls:
            return ExtractedToolCallInformation(tools_called=False, tool_calls=[], content=model_output)
        return ExtractedToolCallInformation(
            tools_called=True,
            tool_calls=[
                ToolCall(id=make_tool_call_id(), type="function", function=FunctionCall(name=c["name"], arguments=c["arguments"]))
                for c in calls
            ],
            content=content,
        )

    def extract_tool_calls_streaming(
        self,
        previous_text: str,
        current_text: str,
        delta_text: str,
        previous_token_ids: Sequence[int],
        current_token_ids: Sequence[int],
        delta_token_ids: Sequence[int],
        request,
    ) -> DeltaMessage | None:
        if self._state is None:
            names = _tool_names(request)
            self._state = StreamState(tool_names=names, mode="maybe" if names else "content")
        content, calls = self._state.feed(delta_text)
        return self._delta(content, calls)

    def finish_streaming(self) -> DeltaMessage | None:
        if self._state is None:
            return None
        content, calls = self._state.finish()
        return self._delta(content, calls)

    def _delta(self, content: str | None, calls: list[dict]) -> DeltaMessage | None:
        if not calls:
            return DeltaMessage(content=content) if content else None
        deltas = []
        for call in calls:
            self.current_tool_id += 1
            self.prev_tool_call_arr.append({"name": call["name"], "arguments": call["arguments"]})
            self.streamed_args_for_tool.append(call["arguments"])
            deltas.append(
                DeltaToolCall(
                    index=self.current_tool_id,
                    type="function",
                    id=make_tool_call_id(),
                    function=DeltaFunctionCall(name=call["name"], arguments=call["arguments"]).model_dump(exclude_none=True),
                )
            )
        return DeltaMessage(content=content, tool_calls=deltas)
