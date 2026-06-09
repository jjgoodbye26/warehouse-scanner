"""
SPA-aware static file server for the built React app.
Serves files from dist/. Any path that doesn't match a real file
falls back to dist/index.html — same as the Vercel rewrite rule.
"""
import http.server
import os
import sys

DIST = os.path.join(os.path.dirname(__file__), "dist")
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 3000

class SPAHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIST, **kwargs)

    def do_GET(self):
        # If the requested path exists as a real file, serve it directly
        real_path = os.path.join(DIST, self.path.lstrip("/").split("?")[0])
        if os.path.isfile(real_path):
            super().do_GET()
        else:
            # SPA fallback: serve index.html for all unknown routes
            self.path = "/index.html"
            super().do_GET()

    def log_message(self, fmt, *args):
        pass  # Suppress access logs for clean output

with http.server.HTTPServer(("", PORT), SPAHandler) as httpd:
    print(f"Serving dist/ on http://localhost:{PORT}", flush=True)
    httpd.serve_forever()
