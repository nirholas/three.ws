"""Contract tests for the Gradio Space: the MCP tool schema and the error mapping."""

import unittest

import gradio as gr

import app


class SpaceContractTest(unittest.TestCase):
    def test_tool_is_exposed_under_its_api_name(self):
        names = [name for name in app.demo.get_api_info()["named_endpoints"]]
        self.assertIn("/forge_text_to_3d", names)

    def test_rejects_unknown_tier_before_any_network_call(self):
        with self.assertRaises(gr.Error):
            app.forge_text_to_3d("a small wooden chair", "ultra")

    def test_rejects_short_prompt_with_a_clear_message(self):
        with self.assertRaises(gr.Error) as ctx:
            app.forge_text_to_3d("ab", "draft")
        self.assertIn("at least 3 characters", str(ctx.exception))

    def test_viewer_link_encodes_the_glb_url(self):
        url = app._viewer_url("https://cdn.example/a b.glb")
        self.assertEqual(url, "https://three.ws/viewer?src=https%3A%2F%2Fcdn.example%2Fa%20b.glb")


if __name__ == "__main__":
    unittest.main()
