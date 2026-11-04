from typing import Any

from dify_plugin import ToolProvider


class ThreeWsProvider(ToolProvider):
    def _validate_credentials(self, credentials: dict[str, Any]) -> None:
        """The free three.ws studio is anonymous, so there is nothing to validate."""
        return None
