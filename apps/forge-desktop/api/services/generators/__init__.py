# Adapters are loaded dynamically from extensions/ by generator_registry.py.
# This file only exposes BaseGenerator for external imports.
from .base import BaseGenerator, smooth_progress

__all__ = ["BaseGenerator", "smooth_progress"]
