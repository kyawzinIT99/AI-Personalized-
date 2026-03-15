"""
Clawbot — Modal deployment
Uses @modal.asgi_app() with a FastAPI proxy → Node.js server on port 3737.
Includes WebSocket proxy at /ws → ws://127.0.0.1:3737
"""
import modal
import subprocess

app = modal.App("clawbot")

# Persistent volume — survives restarts and redeploys
clawbot_volume = modal.Volume.from_name("clawbot-data", create_if_missing=True)

PROJECT = "/Users/berry/Antigravity/Clawbot webiste"

image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("curl", "ca-certificates")
    .run_commands(
        "curl -fsSL https://deb.nodesource.com/setup_20.x | bash -",
        "apt-get install -y nodejs",
    )
    .pip_install("fastapi", "httpx", "websockets")
    .workdir("/app")
    .add_local_dir(PROJECT, remote_path="/app",
                   ignore=["node_modules", ".git", "*.py", "__pycache__"],
                   copy=True)
    .run_commands("npm install --omit=dev")
)

# ── FastAPI proxy ──────────────────────────────────────────────
from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import Response
import httpx
import asyncio
import websockets as ws_lib

proxy_app = FastAPI()

NODE_HTTP = "http://127.0.0.1:3737"
NODE_WS   = "ws://127.0.0.1:3737"


# ── WebSocket proxy at /ws ──────────────────────────────────────
@proxy_app.websocket("/ws")
async def websocket_proxy(client_ws: WebSocket):
    await client_ws.accept()
    try:
        async with ws_lib.connect(NODE_WS) as node_ws:
            async def client_to_node():
                try:
                    async for msg in client_ws.iter_text():
                        await node_ws.send(msg)
                except (WebSocketDisconnect, Exception):
                    pass

            async def node_to_client():
                try:
                    async for msg in node_ws:
                        await client_ws.send_text(msg if isinstance(msg, str) else msg.decode())
                except Exception:
                    pass

            await asyncio.gather(client_to_node(), node_to_client())
    except Exception:
        pass
    finally:
        try:
            await client_ws.close()
        except Exception:
            pass


# ── HTTP proxy (catch-all) ──────────────────────────────────────
@proxy_app.api_route("/{path:path}", methods=["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS"])
async def proxy(path: str, request: Request):
    url = f"{NODE_HTTP}/{path}"
    body = await request.body()
    headers = {
        k: v for k, v in request.headers.items()
        if k.lower() not in ("host", "content-length")
    }
    async with httpx.AsyncClient(timeout=120) as client:
        resp = await client.request(
            method=request.method,
            url=url,
            headers=headers,
            content=body,
            params=dict(request.query_params),
        )
    return Response(
        content=resp.content,
        status_code=resp.status_code,
        headers=dict(resp.headers),
    )


# ── Modal function ─────────────────────────────────────────────
@app.function(image=image, timeout=3600, volumes={"/data": clawbot_volume})
@modal.concurrent(max_inputs=100)
@modal.asgi_app()
def serve():
    import time, socket

    proc = subprocess.Popen(
        ["node", "server.js"],
        cwd="/app",
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
    )

    for _ in range(60):
        try:
            with socket.create_connection(("127.0.0.1", 3737), timeout=1):
                print("✅ Node.js server is up on :3737", flush=True)
                break
        except OSError:
            line = proc.stdout.readline()
            if line:
                print(line.decode(), end="", flush=True)
            time.sleep(0.5)

    return proxy_app
