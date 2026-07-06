"""
Service layer — pure CRUD for Task and Link entities.

No graph logic, no helpers — just 8 functions.
"""

from __future__ import annotations

from datetime import datetime, timezone

from sqlmodel import Session, select

from model import Task, Link, AuditLog, LinkType, TaskStatus, TaskType


# ── Task CRUD ──────────────────────────────────────────────────────────────────


def create_task(
    session: Session,
    *,
    title: str,
    description: str | None = None,
    task_type: TaskType = TaskType.EXECUTION,
    tags: list[str] | None = None,
    source: str | None = None,
    status: TaskStatus = TaskStatus.TODO,
    deadline: datetime | None = None,
    duration: int | None = None,
    people: list[str] | None = None,
    location: str | None = None,
    plan: str | None = None,
    log: str | None = None,
    review: str | None = None,
) -> Task:
    """Create a new Task and return it (with auto-generated id)."""
    task = Task(
        title=title,
        task_type=task_type,
        tags=tags or [],
        description=description,
        source=source,
        status=status,
        deadline=deadline,
        duration=duration,
        people=people or [],
        location=location,
        plan=plan,
        log=log,
        review=review,
    )
    session.add(task)
    session.commit()
    session.refresh(task)
    return task


def list_tasks(session: Session) -> list[Task]:
    """Return all tasks, newest first."""
    return list(session.exec(select(Task).order_by(Task.id.desc())).all())


def read_task(session: Session, task_id: int) -> Task | None:
    """Return a Task by id, or None."""
    return session.get(Task, task_id)


def update_task(session: Session, task_id: int, **fields) -> Task | None:
    """Update mutable fields on a Task.

    Allowed: description, task_type, tags, source, status,
             deadline, duration, people, location, plan, log, review.
    """
    allowed = {
        "title", "description", "task_type", "tags", "source", "status",
        "deadline", "duration", "people", "location",
        "plan", "log", "review",
    }
    task = session.get(Task, task_id)
    if task is None:
        return None

    for k, v in fields.items():
        if k in allowed:
            setattr(task, k, v)

    task.updated_at = datetime.now(timezone.utc)
    session.add(task)
    session.commit()
    session.refresh(task)
    return task


def delete_task(session: Session, task_id: int) -> bool:
    """Hard-delete a Task and all its associated Links.  Returns True if deleted."""
    task = session.get(Task, task_id)
    if task is None:
        return False

    links = session.exec(
        select(Link).where(
            (Link.from_task_id == task_id) | (Link.to_task_id == task_id)
        )
    ).all()
    for lnk in links:
        session.delete(lnk)

    session.delete(task)
    session.commit()
    return True


# ── Link CRUD ──────────────────────────────────────────────────────────────────


def create_link(
    session: Session,
    from_task_id: int,
    to_task_id: int,
    link_type: LinkType,
    *,
    note: str | None = None,
) -> tuple[Link | None, str | None]:
    """Create a Link between two tasks.

    Validates both tasks exist and rejects self-loops + duplicates.
    Returns (link, error_message).
    """
    if from_task_id == to_task_id:
        return (None, "Cannot link a task to itself")

    if session.get(Task, from_task_id) is None:
        return (None, f"Source task {from_task_id} not found")
    if session.get(Task, to_task_id) is None:
        return (None, f"Target task {to_task_id} not found")

    existing = session.exec(
        select(Link).where(
            Link.from_task_id == from_task_id,
            Link.to_task_id == to_task_id,
            Link.link_type == link_type,
        )
    ).first()
    if existing:
        return (None, f"{link_type.value} link already exists between {from_task_id} → {to_task_id}")

    link = Link(
        from_task_id=from_task_id,
        to_task_id=to_task_id,
        link_type=link_type,
        note=note,
    )
    session.add(link)
    session.commit()
    session.refresh(link)
    return (link, None)


def read_link(session: Session, link_id: int) -> Link | None:
    """Return a Link by id, or None."""
    return session.get(Link, link_id)


def list_links(session: Session) -> list[Link]:
    """Return all links, newest first."""
    return list(session.exec(select(Link).order_by(Link.id.desc())).all())


def update_link(session: Session, link_id: int, *, link_type: LinkType | None = None, note: str | None = None) -> Link | None:
    """Update a Link's type or note.  Returns the updated Link or None if not found."""
    link = session.get(Link, link_id)
    if link is None:
        return None

    if link_type is not None:
        link.link_type = link_type
    link.note = note
    session.add(link)
    session.commit()
    session.refresh(link)
    return link


def delete_link(session: Session, link_id: int) -> tuple[Link | None, str | None]:
    """Hard-delete a Link by id.

    Returns (link_before_deletion, error_message).
    """
    link = session.get(Link, link_id)
    if link is None:
        return (None, "Link not found")

    session.delete(link)
    session.commit()
    return (link, None)


# ── Audit CRUD ────────────────────────────────────────────────────────────────


def list_audit_logs(
    session: Session,
    *,
    entity_type: str | None = None,
    entity_id: int | None = None,
    action: str | None = None,
    limit: int = 100,
) -> list[AuditLog]:
    """Return audit logs, newest first.  Optional filters."""
    stmt = select(AuditLog)
    if entity_type:
        stmt = stmt.where(AuditLog.entity_type == entity_type)
    if entity_id is not None:
        stmt = stmt.where(AuditLog.entity_id == entity_id)
    if action:
        stmt = stmt.where(AuditLog.action == action)
    stmt = stmt.order_by(AuditLog.id.desc()).limit(limit)
    return list(session.exec(stmt).all())


def read_audit_log(session: Session, audit_id: int) -> AuditLog | None:
    """Return a single AuditLog by id, or None."""
    return session.get(AuditLog, audit_id)