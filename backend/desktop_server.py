import logging
import os

from app.main import app

logger = logging.getLogger("desktop-server")

if __name__ == "__main__":
    import uvicorn

    # Desktop production should use 127.0.0.1 and a specific port.
    port = int(os.environ.get("DCF_BACKEND_PORT", 8000))
    host = "127.0.0.1"

    logger.info("Starting desktop backend on %s:%s", host, port)
    uvicorn.run(app, host=host, port=port)
