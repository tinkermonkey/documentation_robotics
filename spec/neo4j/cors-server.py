#!/usr/bin/env python3
"""
Simple HTTP server with CORS headers for Neo4j Browser guides.
"""
from http.server import HTTPServer, SimpleHTTPRequestHandler
import sys

class CORSRequestHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, Accept, X-Requested-With')
        self.send_header('Access-Control-Max-Age', '86400')
        super().end_headers()

    def do_OPTIONS(self):
        print(f'OPTIONS request for: {self.path}')
        self.send_response(200, 'OK')
        self.send_header('Content-Length', '0')
        self.end_headers()

    def do_GET(self):
        print(f'GET request for: {self.path}')
        return super().do_GET()

    def log_message(self, format, *args):
        # Override to add timestamp and make logs clearer
        sys.stdout.write("%s - - [%s] %s\n" % (
            self.address_string(),
            self.log_date_time_string(),
            format % args
        ))

if __name__ == '__main__':
    port = 8000
    server = HTTPServer(('', port), CORSRequestHandler)
    print(f'Serving on http://localhost:{port}')
    print('Press Ctrl+C to stop')
    server.serve_forever()
