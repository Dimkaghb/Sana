"""Serve the offline web build and backend through one TLS origin.

Start with python -m scripts.stage --help. The identity service remains private.
"""
import argparse
import ipaddress
import os
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]


def build_app(dist: Path):
    from fastapi import HTTPException
    from fastapi.responses import FileResponse
    from starlette.staticfiles import StaticFiles

    from backend.main import create_app

    dist = dist.resolve(strict=True)
    index = dist / "index.html"
    if not index.is_file():
        raise RuntimeError("Build the frontend before starting the stage server.")

    app = create_app()

    # Register known client routes only. Missing API paths must stay 404s.
    async def client_page():
        return FileResponse(index, headers={"Cache-Control": "no-cache"})

    for route in ("/", "/mobile", "/dashboard", "/dashboard/map", "/dashboard/accounts", "/dashboard/signals", "/guardian"):
        app.add_api_route(route, client_page, methods=["GET"], include_in_schema=False)

    class StageAssets(StaticFiles):
        async def get_response(self, path, scope):
            if path.split("/", 1)[0] in {"api", "ws", "ml"}:
                raise HTTPException(404)
            return await super().get_response(path, scope)

    app.mount("/", StageAssets(directory=dist), name="stage-assets")
    return app


def local_app():
    return build_app(ROOT / "frontend/dist")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--origin", required=True, help="HTTPS origin used by both phones, including port")
    parser.add_argument("--bind", default="127.0.0.1", help="LAN interface IP or loopback")
    parser.add_argument("--cert", required=True, type=Path)
    parser.add_argument("--key", required=True, type=Path)
    args = parser.parse_args()
    origin = urlsplit(args.origin)
    if (origin.scheme != "https" or not origin.hostname or origin.username or origin.password
            or origin.path or origin.query or origin.fragment):
        parser.error("--origin must be an HTTPS origin without a path")
    ipaddress.ip_address(args.bind)
    for path in (args.cert, args.key):
        if not path.is_file():
            parser.error(f"Missing TLS file: {path}")
    os.environ["SANA_ALLOWED_ORIGINS"] = args.origin
    import uvicorn

    uvicorn.run(build_app(ROOT / "frontend" / "dist"), host=args.bind, port=origin.port or 443,
                ssl_certfile=str(args.cert), ssl_keyfile=str(args.key), access_log=False)


if __name__ == "__main__":
    main()
