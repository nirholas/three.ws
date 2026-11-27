#!/usr/bin/env python3
"""Reproduce the open DNS-rebinding gap in workers/*/worker_security.py.

The worker resolves a hostname to check it is public, then httpx resolves it a
second time to connect. A host whose DNS answers a public address on the first
lookup and 127.0.0.1 on the second passes the check and is connected to anyway.

Run: python3 -I scripts/forge-worker-rebind-repro.py

httpx is not needed: a tiny stand-in module that connects the way httpcore does
(socket.create_connection by hostname, so the OS resolver runs again) is
installed before worker_security is imported. A real internal server on
127.0.0.1 shows what the connection reaches. Expected output while the gap is
open: the secret body is fetched. After the worker pins the validated address,
the run prints "blocked".

The fix is in the vendored worker_security.py (36 workers, one of them the
protected TRELLIS lane), which is why it waits on the owner. See
docs/forge-input-security.md.
"""
import http.server
import os
import socket
import sys
import threading
import types
from urllib.parse import urljoin, urlsplit

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def install_stand_in_httpx():
    mod = types.ModuleType("httpx")
    source = r'''
import socket
from urllib.parse import urlsplit, urljoin

class HTTPError(Exception): pass
class TransportError(HTTPError): pass
class HTTPStatusError(HTTPError):
    def __init__(self, msg, response=None): super().__init__(msg); self.response = response

class _Resp:
    def __init__(self, url, status, headers, body):
        self.url = _URL(url); self.status_code = status; self.headers = headers; self._body = body
    @property
    def is_redirect(self): return self.status_code in (301, 302, 303, 307, 308)
    def raise_for_status(self):
        if self.status_code >= 400: raise HTTPStatusError("status", self)
    def iter_bytes(self, n): yield self._body
    def __enter__(self): return self
    def __exit__(self, *a): return False

class _URL(str):
    def join(self, loc): return urljoin(str(self), loc)

class Client:
    def __init__(self, **kw): pass
    def __enter__(self): return self
    def __exit__(self, *a): return False
    def stream(self, method, url, headers=None):
        parts = urlsplit(url)
        port = parts.port or (443 if parts.scheme == "https" else 80)
        s = socket.create_connection((parts.hostname, port), timeout=5)
        peer = s.getpeername()[0]
        s.sendall(f"GET {parts.path or '/'} HTTP/1.0\r\nHost: {parts.hostname}\r\n\r\n".encode())
        data = b""
        while chunk := s.recv(4096): data += chunk
        s.close()
        head, _, body = data.partition(b"\r\n\r\n")
        status = int(head.split()[1])
        print(f"  connected to {peer}")
        return _Resp(url, status, {}, body)
'''
    exec(compile(source, "httpx-stand-in", "exec"), mod.__dict__)
    sys.modules["httpx"] = mod


class Internal(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
        self.end_headers()
        self.wfile.write(b"INTERNAL-SECRET")

    def log_message(self, *args):
        pass


def main():
    install_stand_in_httpx()
    sys.path.insert(0, os.path.join(ROOT, "workers", "avatar-pipeline-controller"))

    srv = http.server.HTTPServer(("127.0.0.1", 0), Internal)
    port = srv.server_address[1]
    threading.Thread(target=srv.serve_forever, daemon=True).start()

    real = socket.getaddrinfo
    calls = {"n": 0}

    def rebinding(host, *a, **k):
        if host == "rebind.attacker.test":
            calls["n"] += 1
            ip = "93.184.216.34" if calls["n"] == 1 else "127.0.0.1"
            print(f"  DNS answer #{calls['n']} for {host}: {ip}")
            return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", (ip, port))]
        return real(host, *a, **k)

    socket.getaddrinfo = rebinding

    import worker_security as ws

    try:
        body = ws.fetch_remote_bytes(f"http://rebind.attacker.test:{port}/", allow_http=True)
        print("RESULT: fetched", body, "(checked as public, connected to 127.0.0.1)")
        return 1
    except Exception as exc:
        print("RESULT: blocked", type(exc).__name__, exc)
        return 0


if __name__ == "__main__":
    sys.exit(main())
