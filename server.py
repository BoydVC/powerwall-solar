#!/usr/bin/env python3
"""Powerwall & Solar Payback server — 127.0.0.1:4312."""
import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
PORT = int(os.environ.get("PORT", 4312))


def rd(rel):
    with open(os.path.join(HERE, rel), encoding="utf-8") as f:
        return f.read()


def rates_js():
    p = os.path.join(HERE, "data", "rates.json")
    if os.path.isfile(p):
        return open(p, encoding="utf-8").read()
    return "null"


def page():
    html = rd("web/index.html")
    html = html.replace("/*__CSS__*/", rd("web/app.css"))
    html = html.replace("/*__RATES__*/ null /*__/RATES__*/", rates_js())
    html = html.replace(
        "/*__APP__*/", rd("web/app.js").replace("</script", "<\\/script")
    )
    return html


class H(BaseHTTPRequestHandler):
    def send(self, code, body, ctype):
        b = body.encode() if isinstance(body, str) else body
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(b)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(b)

    def do_GET(self):
        path = self.path.split("?")[0]
        try:
            if path in ("/", "/index.html", "/powerwall-solar.html"):
                self.send(200, page(), "text/html; charset=utf-8")
            elif path == "/api/rates":
                raw = rates_js()
                if raw == "null":
                    self.send(
                        404,
                        json.dumps({"error": "rates.json missing"}),
                        "application/json",
                    )
                    return
                self.send(200, raw, "application/json")
            elif path == "/health":
                self.send(
                    200,
                    json.dumps({"ok": True, "port": PORT, "app": "powerwall-solar"}),
                    "application/json",
                )
            else:
                self.send(404, "not found", "text/plain")
        except Exception as ex:
            self.send(500, f"error: {ex}", "text/plain")

    def log_message(self, fmt, *args):
        print(f"[powerwall-solar] {args[0]}")


if __name__ == "__main__":
    httpd = ThreadingHTTPServer(("127.0.0.1", PORT), H)
    print(f"Powerwall & Solar Payback http://127.0.0.1:{PORT}/")
    httpd.serve_forever()
