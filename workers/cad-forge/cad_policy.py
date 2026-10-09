"""
Static policy for model-written build123d programs.

CAD Forge executes Python that a language model wrote from a stranger's prompt,
so the program is treated as hostile. This module is the first of four layers
(the others are a seccomp filter, an unprivileged uid, and resource limits; see
``sandbox_child.py`` and ``main.py``). It parses the source once and refuses
anything a parametric part has no reason to contain:

  * imports outside ``ALLOWED_MODULES``
  * any attribute or name that starts with an underscore (``__class__``,
    ``__globals__``, ``_private``), which is how every classic Python sandbox
    escape walks from a harmless object to ``os``
  * the builtins that read files, evaluate strings, or reach into frames
  * ``str.format`` and friends, whose field syntax (``"{0.__class__}"``) does
    attribute lookups the AST cannot see

It also supplies the trimmed ``__builtins__`` the program runs under and a
guarded ``__import__`` that honours the same allowlist at runtime.

Stdlib only, so it can be unit tested without OpenCascade installed.
"""

from __future__ import annotations

import ast
import builtins
import types
from dataclasses import dataclass
from typing import Optional

MAX_SOURCE_CHARS = 40_000
MAX_AST_NODES = 20_000

# Modules a program may import. build123d is the modeling API, bd_warehouse its
# author's library of standard parts (involute gears, ISO threads, fasteners,
# bearings); math, itertools and functools cover the arithmetic and iteration
# real parametric parts use.
ALLOWED_MODULES = frozenset({"build123d", "bd_warehouse", "math", "itertools", "functools"})

# Modules a program may bind whole (`import math`). The CAD libraries are
# reachable only through `from ... import Name`, because a bound module object
# lets a program walk into whatever that library imported (`build123d.exporters.os`).
WHOLE_IMPORT_MODULES = frozenset({"math", "itertools", "functools"})

# `from X import *` is only safe where X curates __all__.
STAR_IMPORT_MODULES = frozenset({"build123d"})

BANNED_NAMES = frozenset({
    "eval", "exec", "compile", "open", "input", "breakpoint", "help",
    "globals", "locals", "vars", "dir",
    "getattr", "setattr", "delattr",
    "exit", "quit", "memoryview", "object", "type",
    "__import__", "__builtins__", "__loader__", "__spec__",
})

# Attribute names that perform attribute lookups from inside a string.
BANNED_ATTRIBUTES = frozenset({"format", "format_map", "vformat", "mro"})

SAFE_BUILTIN_NAMES = (
    "abs", "all", "any", "bool", "dict", "divmod", "enumerate", "filter",
    "float", "frozenset", "hasattr", "int", "isinstance", "iter", "len", "list",
    "map", "max", "min", "next", "pow", "print", "range", "reversed", "round",
    "set", "slice", "sorted", "str", "sum", "tuple", "zip", "super",
    "property", "staticmethod", "classmethod",
    "ArithmeticError", "AssertionError", "Exception", "IndexError", "KeyError",
    "RuntimeError", "StopIteration", "TypeError", "ValueError",
    "ZeroDivisionError", "NotImplementedError",
)


@dataclass
class PolicyViolation(Exception):
    message: str
    line: Optional[int] = None

    def __str__(self) -> str:
        return f"line {self.line}: {self.message}" if self.line else self.message


def _top_module(name: str) -> str:
    return (name or "").split(".", 1)[0]


def _private_path(name: str) -> bool:
    return any(part.startswith("_") for part in (name or "").split("."))


def check_source(source: str) -> ast.Module:
    """Parse and vet a program. Returns the AST or raises PolicyViolation.

    A SyntaxError propagates unchanged so the caller can report it as a syntax
    problem (with its line) rather than a policy refusal.
    """
    if not isinstance(source, str) or not source.strip():
        raise PolicyViolation("The program is empty.")
    if len(source) > MAX_SOURCE_CHARS:
        raise PolicyViolation(f"The program is longer than {MAX_SOURCE_CHARS} characters.")

    tree = ast.parse(source, filename="<design>", mode="exec")

    count = 0
    for node in ast.walk(tree):
        count += 1
        if count > MAX_AST_NODES:
            raise PolicyViolation("The program is too large to build.")
        line = getattr(node, "lineno", None)

        if isinstance(node, ast.Import):
            for alias in node.names:
                if _private_path(alias.name):
                    raise PolicyViolation(f"importing '{alias.name}' is not allowed.", line)
                if _top_module(alias.name) not in ALLOWED_MODULES:
                    raise PolicyViolation(f"import of '{alias.name}' is not allowed; only build123d, bd_warehouse, math, itertools and functools are available.", line)
                if alias.name not in WHOLE_IMPORT_MODULES:
                    raise PolicyViolation(f"use 'from {alias.name} import ...' instead of 'import {alias.name}'.", line)
        elif isinstance(node, ast.ImportFrom):
            if node.level:
                raise PolicyViolation("relative imports are not allowed.", line)
            if _private_path(node.module or ""):
                raise PolicyViolation(f"importing from '{node.module}' is not allowed.", line)
            if _top_module(node.module or "") not in ALLOWED_MODULES:
                raise PolicyViolation(f"import from '{node.module}' is not allowed; only build123d, bd_warehouse, math, itertools and functools are available.", line)
            for alias in node.names:
                if alias.name == "*" and node.module not in STAR_IMPORT_MODULES:
                    raise PolicyViolation(f"'from {node.module} import *' is not allowed; import the names you use.", line)
                if alias.name != "*" and alias.name.startswith("_"):
                    raise PolicyViolation(f"importing '{alias.name}' is not allowed.", line)
        elif isinstance(node, ast.Attribute):
            if node.attr.startswith("_"):
                raise PolicyViolation(f"access to '.{node.attr}' is not allowed.", line)
            if node.attr in BANNED_ATTRIBUTES:
                raise PolicyViolation(f"'.{node.attr}' is not available; use an f-string instead.", line)
        elif isinstance(node, ast.Name):
            if node.id in BANNED_NAMES:
                raise PolicyViolation(f"'{node.id}' is not available in a CAD program.", line)
            if node.id.startswith("__"):
                raise PolicyViolation(f"the name '{node.id}' is not allowed.", line)
        elif isinstance(node, (ast.AsyncFunctionDef, ast.Await, ast.AsyncFor, ast.AsyncWith)):
            raise PolicyViolation("async code is not allowed.", line)
        elif isinstance(node, (ast.FunctionDef, ast.ClassDef)):
            if node.name.startswith("__"):
                raise PolicyViolation(f"defining '{node.name}' is not allowed.", line)
        elif isinstance(node, ast.arg):
            if node.arg.startswith("__"):
                raise PolicyViolation(f"the argument name '{node.arg}' is not allowed.", line)
        elif isinstance(node, ast.keyword):
            if node.arg and node.arg.startswith("__"):
                raise PolicyViolation(f"the keyword '{node.arg}' is not allowed.", line)
    return tree


def guarded_import(name, globals=None, locals=None, fromlist=(), level=0):
    """``__import__`` for the program namespace: allowlisted modules only."""
    if level or _private_path(name) or _top_module(name) not in ALLOWED_MODULES:
        raise ImportError(f"import of '{name}' is not allowed")
    if not fromlist and name not in WHOLE_IMPORT_MODULES:
        raise ImportError(f"use 'from {name} import ...' instead of 'import {name}'")
    for item in fromlist or ():
        if item == "*" and name not in STAR_IMPORT_MODULES:
            raise ImportError(f"'from {name} import *' is not allowed")
        if item != "*" and str(item).startswith("_"):
            raise ImportError(f"importing '{item}' is not allowed")
    module = builtins.__import__(name, globals, locals, fromlist, level)
    for item in fromlist or ():
        if item != "*" and isinstance(getattr(module, item, None), types.ModuleType):
            raise ImportError(f"'{item}' is a module; import the names you use from it")
    return module


def safe_builtins() -> dict:
    table = {name: getattr(builtins, name) for name in SAFE_BUILTIN_NAMES}
    table["__import__"] = guarded_import
    # `class` statements resolve this name; without it a helper class fails.
    table["__build_class__"] = builtins.__build_class__
    return table
