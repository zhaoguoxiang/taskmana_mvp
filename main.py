"""
TaskMana MVP — Task & Link CRUD with Kanban UI.

Start with:
    uv run python main.py              # default: http://0.0.0.0:8000
    uv run python main.py --port 9000  # custom port
    uv run python main.py --db ./mydb.db  # custom database path
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import uvicorn


def main():
    parser = argparse.ArgumentParser(description="TaskMana MVP Server")
    parser.add_argument("--host", default="0.0.0.0", help="Bind address (default: 0.0.0.0)")
    parser.add_argument("--port", type=int, default=8000, help="Port (default: 8000)")
    parser.add_argument("--db", default=None, help="SQLite database path (default: ./taskmana.db)")
    parser.add_argument("--reload", action="store_true", help="Enable auto-reload for development")
    args = parser.parse_args()

    # Initialize DB before starting server.
    from database import init_db
    db_path = Path(args.db) if args.db else None
    init_db(db_path)
    db_display = db_path.resolve() if db_path else Path(__file__).resolve().parent / "taskmana.db"
    print(f"✓ Database initialized at {db_display}")

    print(f"✓ Starting TaskMana MVP on http://{args.host}:{args.port}")
    print(f"✓ API docs at http://{args.host}:{args.port}/docs")
    print()

    uvicorn.run(
        "api:app",
        host=args.host,
        port=args.port,
        reload=args.reload,
    )


if __name__ == "__main__":
    main()
