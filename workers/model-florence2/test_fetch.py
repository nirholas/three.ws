"""Poster fetch retries a 429 (run with: python3 test_fetch.py).

The 2026-11-11 backfill run2-3 lost 44 of 1,400 posters to "429 Too Many
Requests" from three.ws/api/render, the renderer that draws a poster for a
creation without a stored preview. A 429 is the renderer asking us to slow
down, not a broken image, so the fetch waits (Retry-After when sent) and tries
again before giving up.
"""

import unittest

import httpx

import fetch


def status_error(code: int, retry_after: str | None = None) -> httpx.HTTPStatusError:
    headers = {"retry-after": retry_after} if retry_after is not None else {}
    req = httpx.Request("GET", "https://three.ws/api/render/glb?glbUrl=x")
    return httpx.HTTPStatusError(f"{code}", request=req, response=httpx.Response(code, headers=headers, request=req))


class FakeFetch:
    def __init__(self, outcomes):
        self.outcomes = list(outcomes)
        self.calls = 0

    def __call__(self, url, timeout, max_bytes):
        self.calls += 1
        out = self.outcomes.pop(0)
        if isinstance(out, Exception):
            raise out
        return out


class FetchPosterTest(unittest.TestCase):
    def test_retries_a_429_then_returns_the_body(self):
        slept = []
        f = FakeFetch([status_error(429, "2"), b"png-bytes"])
        self.assertEqual(fetch.fetch_poster("https://x", fetch=f, sleep=slept.append), b"png-bytes")
        self.assertEqual(f.calls, 2)
        self.assertEqual(slept, [2.0])

    def test_backs_off_without_retry_after_and_caps_a_huge_one(self):
        slept = []
        f = FakeFetch([status_error(429), status_error(429, "600"), b"ok"])
        self.assertEqual(fetch.fetch_poster("https://x", fetch=f, sleep=slept.append), b"ok")
        self.assertEqual(len(slept), 2)
        self.assertGreater(slept[0], 0)
        self.assertLessEqual(slept[1], fetch.MAX_WAIT_S)

    def test_gives_up_after_the_last_attempt(self):
        f = FakeFetch([status_error(429)] * fetch.ATTEMPTS)
        with self.assertRaises(httpx.HTTPStatusError):
            fetch.fetch_poster("https://x", fetch=f, sleep=lambda s: None)
        self.assertEqual(f.calls, fetch.ATTEMPTS)

    def test_does_not_retry_other_errors(self):
        f = FakeFetch([status_error(403)])
        with self.assertRaises(httpx.HTTPStatusError):
            fetch.fetch_poster("https://x", fetch=f, sleep=lambda s: None)
        self.assertEqual(f.calls, 1)


if __name__ == "__main__":
    unittest.main(verbosity=1)
