"""
本地小型 HTTP 服务，专为 Mychess（网页版新象棋·战棋）设计。

为什么需要它：
- <script type=module> / fetch 静态资源需要 http(s) 来源，直接双击 index.html 走
  file:// 协议会受限（ES 模块脚本、fetch、localStorage 行为都可能异常）。
- 顺手开浏览器、自动选空闲端口（端口被占用就顺延，不会直接报错）。

用法：
    python serve.py            # 默认 8780 端口，自动开浏览器
    python serve.py 9001       # 指定端口
"""

import http.server
import sys
import threading
import time
import webbrowser
from functools import partial
from pathlib import Path


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    # 显式声明 MIME，避免 Windows 上 .js/.mjs/.css 被当成 octet-stream 加载失败
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        ".js": "text/javascript",
        ".mjs": "text/javascript",
        ".html": "text/html",
        ".css": "text/css",
        ".json": "application/json",
        ".png": "image/png",
        ".webp": "image/webp",
        ".svg": "image/svg+xml",
    }

    def log_message(self, fmt, *args):
        # 安静一点，只记录页面主请求
        if "GET / " in (fmt % args):
            super().log_message(fmt, *args)

    def end_headers(self):
        # 防缓存，方便边改边刷
        self.send_header("Cache-Control", "no-store, max-age=0")
        super().end_headers()


class ThreadingHTTPServer(http.server.ThreadingHTTPServer):
    # 多线程 + 守护线程：避免单线程服务被某个保持连接的客户端（如浏览器 keep-alive）
    # 阻塞，导致后续 .js/.css 资源请求一直挂起。
    daemon_threads = True
    allow_reuse_address = True


def _make_server(port: int, root: Path, tries: int = 12):
    """从 port 起逐个尝试，找到第一个能绑定的空闲端口。"""
    last_err = None
    handler = partial(QuietHandler, directory=str(root))
    for candidate in range(port, port + tries):
        try:
            return ThreadingHTTPServer(("127.0.0.1", candidate), handler), candidate
        except OSError as e:  # 端口被占用，换下一个
            last_err = e
            continue
    raise last_err if last_err else OSError("no free port")


def serve(port: int = 8780):
    root = Path(__file__).resolve().parent
    httpd, port = _make_server(port, root)
    url = f"http://localhost:{port}/index.html"
    with httpd:
        print(f"\n  >> 新象棋·战棋 running at {url}")
        print("  >> Ctrl+C to stop\n")
        threading.Thread(
            target=lambda: (time.sleep(0.6), webbrowser.open(url)),
            daemon=True,
        ).start()
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\n  >> bye")


def run_chess():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8780
    serve(port)


if __name__ == "__main__":
    run_chess()
