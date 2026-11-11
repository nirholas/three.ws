"""Phi-4-mini tool-call parsing, streaming splitter and chat template.

Run: python3 -m pytest workers/model-phi -q
"""

import json
from pathlib import Path

import pytest
from jinja2.sandbox import ImmutableSandboxedEnvironment

from phi_tool_format import INCOMPLETE, INVALID, StreamState, classify_prefix, extract, parse_calls

HERE = Path(__file__).parent
NAMES = {"get_weather", "search_assets"}
CALL = '<|tool_call|>[{"name": "get_weather", "arguments": {"city": "Oslo", "days": [1, 2]}}]<|/tool_call|>'


def test_native_block_keeps_nested_arrays():
    calls = parse_calls(CALL, NAMES)
    assert calls == [{"name": "get_weather", "arguments": json.dumps({"city": "Oslo", "days": [1, 2]})}]


def test_functools_form_and_parameters_key():
    calls = parse_calls('functools[{"name": "search_assets", "parameters": {"q": "chair"}}]', NAMES)
    assert calls == [{"name": "search_assets", "arguments": '{"q": "chair"}'}]


def test_string_arguments_are_normalized():
    calls = parse_calls('[{"name": "get_weather", "arguments": "{\\"city\\": \\"Rome\\"}"}]', NAMES)
    assert calls == [{"name": "get_weather", "arguments": '{"city": "Rome"}'}]


def test_bare_array_needs_offered_tool_names():
    answer = '[{"name": "positive", "arguments": {}}]'
    assert parse_calls(answer, NAMES) == INVALID
    assert extract(answer, NAMES) == (answer, [])


def test_marked_block_accepts_unknown_names():
    assert parse_calls('<|tool_call|>[{"name": "other", "arguments": {}}]', NAMES)[0]["name"] == "other"


def test_incomplete_and_invalid():
    assert parse_calls('<|tool_call|>[{"name": "get_weather", "argu', NAMES) == INCOMPLETE
    assert parse_calls("<|tool_call|>", NAMES) == INCOMPLETE
    assert parse_calls("<|tool_call|>hello", NAMES) == INVALID


def test_classify_prefix():
    assert classify_prefix("") == "maybe"
    assert classify_prefix("  <|tool") == "maybe"
    assert classify_prefix("func") == "maybe"
    assert classify_prefix("[") == "maybe"
    assert classify_prefix("[{") == "tool"
    assert classify_prefix("[Note] hi") == "content"
    assert classify_prefix("Hello") == "content"


def test_extract_keeps_text_before_call():
    content, calls = extract("Checking now. " + CALL, NAMES)
    assert content == "Checking now."
    assert calls[0]["name"] == "get_weather"


def test_extract_plain_answer():
    assert extract("It is sunny.", NAMES) == ("It is sunny.", [])


def _stream(text, names=NAMES, size=3):
    state = StreamState(tool_names=names)
    content, calls = "", []
    for i in range(0, len(text), size):
        c, k = state.feed(text[i:i + size])
        content += c or ""
        calls += k
    c, k = state.finish()
    return content + (c or ""), calls + k


def test_stream_plain_text_passes_through():
    assert _stream("Hello there, friend.") == ("Hello there, friend.", [])


def test_stream_tool_call_released_whole():
    content, calls = _stream(CALL)
    assert content == ""
    assert calls == parse_calls(CALL, NAMES)


def test_stream_releases_unfinished_prefix_as_content():
    assert _stream("func") == ("func", [])
    assert _stream("[{oops") == ("[{oops", [])


def test_stream_bracket_text_is_content():
    assert _stream("[Note] keep this") == ("[Note] keep this", [])


def _render(messages, tools=None):
    # The environment transformers' apply_chat_template builds (vLLM renders through it).
    env = ImmutableSandboxedEnvironment(trim_blocks=True, lstrip_blocks=True, extensions=["jinja2.ext.loopcontrols"])
    env.filters["tojson"] = lambda x, ensure_ascii=False, indent=None, separators=None, sort_keys=False: json.dumps(
        x, ensure_ascii=ensure_ascii, indent=indent, separators=separators, sort_keys=sort_keys
    )
    tpl = env.from_string((HERE / "chat_template.jinja").read_text())
    return tpl.render(messages=messages, tools=tools, add_generation_prompt=True, eos_token="<|endoftext|>")


TOOLS = [{"type": "function", "function": {"name": "get_weather", "description": "Weather", "parameters": {"type": "object"}}}]


def test_template_plain_chat():
    out = _render([{"role": "system", "content": "Be brief."}, {"role": "user", "content": "Hi"}])
    assert out == "<|system|>Be brief.<|end|><|user|>Hi<|end|><|assistant|>"


def test_template_tools_in_system_turn():
    out = _render([{"role": "user", "content": "Weather?"}], TOOLS)
    fn = json.loads(out.split("<|tool|>")[1].split("<|/tool|>")[0])
    assert fn == [TOOLS[0]["function"]]
    assert out.startswith("<|system|>You are a helpful assistant with some tools.<|tool|>")
    assert out.endswith("<|user|>Weather?<|end|><|assistant|>")


def test_template_replays_calls_and_results():
    out = _render(
        [
            {"role": "system", "content": "S"},
            {"role": "user", "content": "Weather?"},
            {"role": "assistant", "content": None, "tool_calls": [{"id": "1", "type": "function", "function": {"name": "get_weather", "arguments": {"city": "Oslo"}}}]},
            {"role": "tool", "tool_call_id": "1", "content": "12C"},
        ],
        TOOLS,
    )
    assert '<|assistant|><|tool_call|>[{"name": "get_weather", "arguments": {"city": "Oslo"}}]<|/tool_call|><|end|>' in out
    assert out.endswith("<|tool_response|>12C<|end|><|assistant|>")
    assert out.count("<|system|>") == 1


@pytest.mark.parametrize("args", ['{"city": "Oslo"}', {"city": "Oslo"}])
def test_template_call_args_string_or_object(args):
    out = _render([{"role": "assistant", "content": "", "tool_calls": [{"function": {"name": "f", "arguments": args}}]}])
    assert '"arguments": {"city": "Oslo"}' in out


def test_template_tools_once_with_several_system_turns():
    out = _render([{"role": "system", "content": "Persona"}, {"role": "system", "content": "Rules"}, {"role": "user", "content": "Hi"}], TOOLS)
    assert out.count("<|tool|>") == 1
    assert out.startswith("<|system|>Persona<|tool|>")
    assert "<|system|>Rules<|end|>" in out
