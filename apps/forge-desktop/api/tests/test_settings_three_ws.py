import asyncio
import os
import unittest
from unittest import mock

from routers.settings import ThreeWsAccountUpdate, update_three_ws_account


class ThreeWsAccountSettingsTests(unittest.TestCase):
    """POST /settings/three-ws keeps the bundled three.ws extensions on the signed-in account."""

    def setUp(self) -> None:
        patcher = mock.patch.dict(os.environ, {}, clear=False)
        patcher.start()
        self.addCleanup(patcher.stop)
        os.environ.pop("THREE_WS_API_KEY", None)
        os.environ.pop("THREE_WS_BASE_URL", None)

    def _post(self, **body) -> dict:
        return asyncio.run(update_three_ws_account(ThreeWsAccountUpdate(**body)))

    def test_sign_in_sets_the_key_and_origin(self) -> None:
        self.assertEqual(self._post(api_key="sk_live_example", base_url="https://three.ws"), {"ok": True})
        self.assertEqual(os.environ["THREE_WS_API_KEY"], "sk_live_example")
        self.assertEqual(os.environ["THREE_WS_BASE_URL"], "https://three.ws")

    def test_sign_out_removes_the_key(self) -> None:
        os.environ["THREE_WS_API_KEY"] = "sk_live_example"
        self._post(api_key="")
        self.assertNotIn("THREE_WS_API_KEY", os.environ)

    def test_missing_origin_leaves_the_current_one(self) -> None:
        os.environ["THREE_WS_BASE_URL"] = "https://staging.three.ws"
        self._post(api_key="sk_live_example")
        self.assertEqual(os.environ["THREE_WS_BASE_URL"], "https://staging.three.ws")


if __name__ == "__main__":
    unittest.main()
