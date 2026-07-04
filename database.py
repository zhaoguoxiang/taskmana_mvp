"""
Database engine and session management.

Uses SQLite (single-file, zero-config) via SQLModel.
All tables are created automatically on first access.
Foreign keys are enforced at the database level.
"""

from __future__ import annotations

from pathlib import Path
from typing import Generator

from sqlmodel import SQLModel, Session, create_engine
from sqlalchemy import event
from sqlalchemy.engine import Engine

# Default database file lives next to the project root.
DEFAULT_DB_PATH = Path(__file__).resolve().parent / "taskmana.db"

_engine = None


def _enable_foreign_keys(dbapi_connection, connection_record):
    """Enable SQLite foreign key enforcement on every connection."""
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA foreign_keys = ON")
    cursor.close()


def get_engine(db_path: str | Path | None = None):
    """Return (and cache) the SQLAlchemy engine."""
    global _engine
    if _engine is None:
        path = Path(db_path) if db_path else DEFAULT_DB_PATH
        url = f"sqlite:///{path}"
        _engine = create_engine(
            url,
            echo=False,
            connect_args={"check_same_thread": False},
        )
        event.listen(_engine, "connect", _enable_foreign_keys)
    return _engine


def init_db(db_path: str | Path | None = None):
    """Create all tables if they don't exist yet, and clean up orphan links."""
    engine = get_engine(db_path)
    # Import all models so SQLModel metadata sees them before create_all.
    import model  # noqa: F401
    SQLModel.metadata.create_all(engine)

    # Register audit event listeners (after tables are created).
    import audit  # noqa: F401
    audit.register_audit_listeners()

    # Clean up orphan links (links whose task no longer exists)
    with Session(engine) as session:
        from sqlmodel import select as _select
        from model import Link as _Link, Task as _Task
        orphan_links = session.exec(
            _select(_Link).where(
                ~_Link.from_task_id.in_(_select(_Task.id))
                | ~_Link.to_task_id.in_(_select(_Task.id))
            )
        ).all()
        for lnk in orphan_links:
            session.delete(lnk)
        if orphan_links:
            session.commit()


def get_session() -> Generator[Session, None, None]:
    """FastAPI dependency: yields a per-request DB session."""
    engine = get_engine()
    with Session(engine) as session:
        yield session
