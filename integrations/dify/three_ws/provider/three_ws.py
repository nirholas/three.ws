from typing import Any

from dify_plugin import ToolProvider
from dify_plugin.errors.tool import ToolProviderCredentialValidationError

from three_ws_client import ThreeWsError, verify_api_key


class ThreeWsProvider(ToolProvider):
    def _validate_credentials(self, credentials: dict[str, Any]) -> None:
        """Making a model needs a free three.ws account, so check the key against the live server."""
        try:
            verify_api_key(credentials.get("api_key"))
        except ThreeWsError as error:
            raise ToolProviderCredentialValidationError(str(error)) from error
