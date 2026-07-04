"""
Audit logging via SQLAlchemy event hooks.

Automatically captures create / update / delete on Task and Link entities.
Uses full-row snapshots (JSON) stored in the AuditLog table.
"""

from __future__ import annotations

import json
from typing import Any

from sqlalchemy import event
from sqlalchemy.engine import Connection

from model import AuditLog, Link, Task


# ── Serialization helpers (single source of truth) ────────────────────────────


def task_to_dict(t: Task) -> dict[str, Any]:
    return {
        "id": t.id,
        "title": t.title,
        "task_type": t.task_type.value if hasattr(t.task_type, "value") else t.task_type,
        "tags": t.tags,
        "description": t.description,
        "source": t.source,
        "status": t.status.value if hasattr(t.status, "value") else t.status,
        "deadline": t.deadline.isoformat() if t.deadline else None,
        "duration": t.duration,
        "people": t.people,
        "location": t.location,
        "plan": t.plan,
        "log": t.log,
        "review": t.review,
        "created_at": t.created_at.isoformat() if t.created_at else None,
        "updated_at": t.updated_at.isoformat() if t.updated_at else None,
    }


def link_to_dict(lnk: Link) -> dict[str, Any]:
    return {
        "id": lnk.id,
        "from_task_id": lnk.from_task_id,
        "to_task_id": lnk.to_task_id,
        "link_type": lnk.link_type.value if hasattr(lnk.link_type, "value") else lnk.link_type,
        "note": lnk.note,
        "created_at": lnk.created_at.isoformat() if lnk.created_at else None,
    }


# ── Helpers ───────────────────────────────────────────────────────────────────


def _snapshot(entity: Task | Link) -> str:
    """Serialize an entity to a JSON string snapshot."""
    if isinstance(entity, Task):
        return json.dumps(task_to_dict(entity), ensure_ascii=False, default=str)
    if isinstance(entity, Link):
        return json.dumps(link_to_dict(entity), ensure_ascii=False, default=str)
    return "{}"


def _write_audit(
    connection: Connection,
    entity_type: str,
    entity_id: int,
    action: str,
    old_snapshot: str | None = None,
    new_snapshot: str | None = None,
) -> None:
    """Insert a row directly via the raw connection (bypasses ORM session)."""
    connection.execute(
        AuditLog.__table__.insert().values(
            entity_type=entity_type,
            entity_id=entity_id,
            action=action,
            old_snapshot=old_snapshot,
            new_snapshot=new_snapshot,
        )
    )


# ── Event handlers ────────────────────────────────────────────────────────────


def _on_task_after_insert(mapper, connection: Connection, target: Task) -> None:
    _write_audit(
        connection,
        entity_type="task",
        entity_id=target.id,
        action="create",
        new_snapshot=_snapshot(target),
    )


def _on_task_before_update(mapper, connection: Connection, target: Task) -> None:
    """Capture the full old row from the database before the update flush."""
    pk = mapper.primary_key_from_instance(target)
    table = Task.__table__
    old_row = connection.execute(
        table.select().where(table.c.id == pk[0])
    ).fetchone()
    if old_row is not None:
        # Build a temporary Task-like dict from the old row
        target._audit_old_task = dict(old_row._mapping)
    else:
        target._audit_old_task = None


def _on_task_after_update(mapper, connection: Connection, target: Task) -> None:
    old_dict = getattr(target, "_audit_old_task", None)
    old_snapshot = json.dumps(old_dict, ensure_ascii=False, default=str) if old_dict else None
    _write_audit(
        connection,
        entity_type="task",
        entity_id=target.id,
        action="update",
        old_snapshot=old_snapshot,
        new_snapshot=_snapshot(target),
    )
    # Clean up transient attribute
    if hasattr(target, "_audit_old_task"):
        del target._audit_old_task


def _on_task_after_delete(mapper, connection: Connection, target: Task) -> None:
    _write_audit(
        connection,
        entity_type="task",
        entity_id=target.id,
        action="delete",
        old_snapshot=_snapshot(target),
    )


def _on_link_after_insert(mapper, connection: Connection, target: Link) -> None:
    _write_audit(
        connection,
        entity_type="link",
        entity_id=target.id,
        action="create",
        new_snapshot=_snapshot(target),
    )


def _on_link_before_update(mapper, connection: Connection, target: Link) -> None:
    pk = mapper.primary_key_from_instance(target)
    table = Link.__table__
    old_row = connection.execute(
        table.select().where(table.c.id == pk[0])
    ).fetchone()
    if old_row is not None:
        target._audit_old_link = dict(old_row._mapping)
    else:
        target._audit_old_link = None


def _on_link_after_update(mapper, connection: Connection, target: Link) -> None:
    old_dict = getattr(target, "_audit_old_link", None)
    old_snapshot = json.dumps(old_dict, ensure_ascii=False, default=str) if old_dict else None
    _write_audit(
        connection,
        entity_type="link",
        entity_id=target.id,
        action="update",
        old_snapshot=old_snapshot,
        new_snapshot=_snapshot(target),
    )
    if hasattr(target, "_audit_old_link"):
        del target._audit_old_link


def _on_link_after_delete(mapper, connection: Connection, target: Link) -> None:
    _write_audit(
        connection,
        entity_type="link",
        entity_id=target.id,
        action="delete",
        old_snapshot=_snapshot(target),
    )


# ── Registration ──────────────────────────────────────────────────────────────


def register_audit_listeners() -> None:
    """Attach all audit event listeners.  Call once after model definitions are loaded."""

    # Task events
    event.listen(Task, "after_insert", _on_task_after_insert)
    event.listen(Task, "before_update", _on_task_before_update)
    event.listen(Task, "after_update", _on_task_after_update)
    event.listen(Task, "after_delete", _on_task_after_delete)

    # Link events
    event.listen(Link, "after_insert", _on_link_after_insert)
    event.listen(Link, "before_update", _on_link_before_update)
    event.listen(Link, "after_update", _on_link_after_update)
    event.listen(Link, "after_delete", _on_link_after_delete)
