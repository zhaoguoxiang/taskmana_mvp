"""
MCP Server for TaskMana — exposes Task/Link CRUD as MCP tools.

Mounts on the existing FastAPI app via StreamableHTTP transport.
Requires JWT Bearer token authentication (same as REST API).

Tools:
  Task:  list, get, create, update, delete
  Link:  list, get, create, delete
  Query: get_task_graph, get_related_tasks, search_tasks
  Audit: list_audit_logs
"""

from __future__ import annotations

import contextvars
import json
from typing import Any

from fastapi import FastAPI
from starlette.types import ASGIApp, Receive, Scope, Send

from mcp.server.fastmcp import Context, FastMCP
from mcp.server.transport_security import TransportSecuritySettings

from auth import decode_access_token
from database import get_engine, get_session
from model import Link, LinkType, Task, TaskStatus, TaskType, User
from service import (
    create_link,
    create_task,
    delete_link,
    delete_task,
    list_audit_logs,
    list_links,
    list_tasks,
    read_link,
    read_task,
    update_task,
)
from audit import link_to_dict, task_to_dict

# ── Context variable for authenticated user ──────────────────────────────────

current_mcp_user: contextvars.ContextVar[User | None] = contextvars.ContextVar(
    "current_mcp_user", default=None
)


# ── ASGI Auth Middleware ──────────────────────────────────────────────────────

class MCPAuthMiddleware:
    """ASGI middleware: validates Bearer JWT on /mcp paths, sets current_mcp_user."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        path: str = scope.get("path", "")

        if path.startswith("/mcp"):
            auth_header = _extract_header(scope, b"authorization")
            if auth_header is None or not auth_header.lower().startswith("bearer "):
                await _send_401(send, "Missing Authorization header (Bearer token required)")
                return

            token = auth_header[7:]  # strip "Bearer "
            payload = decode_access_token(token)
            if payload is None:
                await _send_401(send, "Invalid or expired token")
                return

            user_id_str: str | None = payload.get("sub")
            if user_id_str is None:
                await _send_401(send, "Invalid token payload")
                return

            from sqlmodel import Session
            engine = get_engine()
            with Session(engine) as session:
                user = session.get(User, int(user_id_str))
                if user is None:
                    await _send_401(send, "User not found")
                    return

            token = current_mcp_user.set(user)
            try:
                await self.app(scope, receive, send)
            finally:
                current_mcp_user.reset(token)
            return

        await self.app(scope, receive, send)


def _extract_header(scope: Scope, name: bytes) -> str | None:
    for header_name, header_value in scope.get("headers", []):
        if header_name.lower() == name.lower():
            return header_value.decode("latin-1")
    return None


async def _send_401(send: Send, detail: str) -> None:
    body = json.dumps({"detail": detail}).encode()
    await send({
        "type": "http.response.start",
        "status": 401,
        "headers": [
            (b"content-type", b"application/json"),
            (b"www-authenticate", b"Bearer"),
        ],
    })
    await send({"type": "http.response.body", "body": body})


# ── Helpers ───────────────────────────────────────────────────────────────────

def _require_user() -> User:
    """Get authenticated user from context, raise if missing."""
    user = current_mcp_user.get()
    if user is None:
        raise RuntimeError("Authentication required")
    return user


def _db_session():
    """Yield a DB session from the module-level engine."""
    engine = get_engine()
    from sqlmodel import Session
    with Session(engine) as session:
        yield session


# ── MCP Server ────────────────────────────────────────────────────────────────

mcp = FastMCP(
    "TaskMana",
    streamable_http_path="/",
    transport_security=TransportSecuritySettings(
        enable_dns_rebinding_protection=False,
    ),
)

# ═══════════════════════════════════════════════════════════════════════════════
# Task Tools
# ═══════════════════════════════════════════════════════════════════════════════


@mcp.tool()
def mcp_list_tasks(ctx: Context) -> list[dict[str, Any]]:
    """List all tasks (newest first).  Returns id, title, status, type, tags, deadline, people."""
    _require_user()
    session = next(_db_session())
    try:
        return [task_to_dict(t) for t in list_tasks(session)]
    finally:
        session.close()


@mcp.tool()
def mcp_get_task(ctx: Context, task_id: int) -> dict[str, Any]:
    """Get full details of a single task by ID."""
    _require_user()
    session = next(_db_session())
    try:
        task = read_task(session, task_id)
        if task is None:
            return {"error": f"Task {task_id} not found"}
        return task_to_dict(task)
    finally:
        session.close()


@mcp.tool()
def mcp_create_task(
    ctx: Context,
    title: str,
    description: str | None = None,
    task_type: str = "execution",
    tags: list[str] | None = None,
    source: str | None = None,
    status: str = "todo",
    deadline: str | None = None,
    duration: int | None = None,
    people: list[str] | None = None,
    location: str | None = None,
    plan: str | None = None,
    log: str | None = None,
    review: str | None = None,
) -> dict[str, Any]:
    """Create a new task.  `title` is required; all other fields are optional.

    `task_type` one of: execution, communication, composite (default: execution).
    `status` one of: todo, in_progress, blocked, done, cancelled, paused (default: todo).
    `deadline` as ISO-8601 string, e.g. "2026-07-10T18:00:00".
    `duration` in minutes.
    """
    _require_user()
    session = next(_db_session())
    try:
        from datetime import datetime
        parsed_deadline = None
        if deadline:
            parsed_deadline = datetime.fromisoformat(deadline)

        task = create_task(
            session,
            title=title,
            description=description,
            task_type=TaskType(task_type),
            tags=tags or [],
            source=source,
            status=TaskStatus(status),
            deadline=parsed_deadline,
            duration=duration,
            people=people or [],
            location=location,
            plan=plan,
            log=log,
            review=review,
        )
        return task_to_dict(task)
    except ValueError as e:
        return {"error": str(e)}
    finally:
        session.close()


@mcp.tool()
def mcp_update_task(
    ctx: Context,
    task_id: int,
    title: str | None = None,
    description: str | None = None,
    task_type: str | None = None,
    tags: list[str] | None = None,
    source: str | None = None,
    status: str | None = None,
    deadline: str | None = None,
    duration: int | None = None,
    people: list[str] | None = None,
    location: str | None = None,
    plan: str | None = None,
    log: str | None = None,
    review: str | None = None,
) -> dict[str, Any]:
    """Update mutable fields on a task.  Only provided fields are changed.

    `task_type` one of: execution, communication, composite.
    `status` one of: todo, in_progress, blocked, done, cancelled, paused.
    `deadline` as ISO-8601 string.
    `duration` in minutes.
    """
    _require_user()
    session = next(_db_session())
    try:
        fields: dict[str, Any] = {}
        if title is not None:
            fields["title"] = title
        if description is not None:
            fields["description"] = description
        if task_type is not None:
            fields["task_type"] = TaskType(task_type)
        if tags is not None:
            fields["tags"] = tags
        if source is not None:
            fields["source"] = source
        if status is not None:
            fields["status"] = TaskStatus(status)
        if deadline is not None:
            from datetime import datetime
            fields["deadline"] = datetime.fromisoformat(deadline)
        if duration is not None:
            fields["duration"] = duration
        if people is not None:
            fields["people"] = people
        if location is not None:
            fields["location"] = location
        if plan is not None:
            fields["plan"] = plan
        if log is not None:
            fields["log"] = log
        if review is not None:
            fields["review"] = review

        if not fields:
            return {"error": "No fields to update"}

        task = update_task(session, task_id, **fields)
        if task is None:
            return {"error": f"Task {task_id} not found"}
        return task_to_dict(task)
    except ValueError as e:
        return {"error": str(e)}
    finally:
        session.close()


@mcp.tool()
def mcp_delete_task(ctx: Context, task_id: int) -> dict[str, Any]:
    """Hard-delete a task and all its associated links."""
    _require_user()
    session = next(_db_session())
    try:
        ok = delete_task(session, task_id)
        if not ok:
            return {"error": f"Task {task_id} not found"}
        return {"deleted": True, "task_id": task_id}
    finally:
        session.close()


# ═══════════════════════════════════════════════════════════════════════════════
# Link Tools
# ═══════════════════════════════════════════════════════════════════════════════


@mcp.tool()
def mcp_list_links(ctx: Context) -> list[dict[str, Any]]:
    """List all links (newest first)."""
    _require_user()
    session = next(_db_session())
    try:
        return [link_to_dict(lnk) for lnk in list_links(session)]
    finally:
        session.close()


@mcp.tool()
def mcp_get_link(ctx: Context, link_id: int) -> dict[str, Any]:
    """Get a single link by ID."""
    _require_user()
    session = next(_db_session())
    try:
        link = read_link(session, link_id)
        if link is None:
            return {"error": f"Link {link_id} not found"}
        return link_to_dict(link)
    finally:
        session.close()


@mcp.tool()
def mcp_create_link(
    ctx: Context,
    from_task_id: int,
    to_task_id: int,
    link_type: str,
    note: str | None = None,
) -> dict[str, Any]:
    """Create a link between two tasks.

    `link_type` one of: contains (parent→child), blocks (hard dependency), derives (source→derived).
    Self-loops and duplicate links are rejected.
    """
    _require_user()
    session = next(_db_session())
    try:
        link, err = create_link(
            session,
            from_task_id=from_task_id,
            to_task_id=to_task_id,
            link_type=LinkType(link_type),
            note=note,
        )
        if err:
            return {"error": err}
        assert link is not None
        return link_to_dict(link)
    except ValueError as e:
        return {"error": str(e)}
    finally:
        session.close()


@mcp.tool()
def mcp_delete_link(ctx: Context, link_id: int) -> dict[str, Any]:
    """Hard-delete a link by ID."""
    _require_user()
    session = next(_db_session())
    try:
        link, err = delete_link(session, link_id)
        if err:
            return {"error": err}
        return {"deleted": True, "link_id": link_id}
    finally:
        session.close()


# ═══════════════════════════════════════════════════════════════════════════════
# Query Tools
# ═══════════════════════════════════════════════════════════════════════════════


@mcp.tool()
def mcp_get_task_graph(ctx: Context) -> dict[str, Any]:
    """Return the full task graph: all tasks and all links.

    Useful for building a network/graph visualization.
    Returns {"tasks": [...], "links": [...]}.
    """
    _require_user()
    session = next(_db_session())
    try:
        return {
            "tasks": [task_to_dict(t) for t in list_tasks(session)],
            "links": [link_to_dict(lnk) for lnk in list_links(session)],
        }
    finally:
        session.close()


@mcp.tool()
def mcp_get_related_tasks(ctx: Context, task_id: int) -> dict[str, Any]:
    """Get all tasks related to a given task via links.

    Returns the center task plus all directly connected tasks, grouped by link direction:
    {"task": {...}, "incoming": [...], "outgoing": [...]}.
    """
    _require_user()
    session = next(_db_session())
    try:
        task = read_task(session, task_id)
        if task is None:
            return {"error": f"Task {task_id} not found"}

        all_links = list_links(session)
        incoming: list[dict[str, Any]] = []
        outgoing: list[dict[str, Any]] = []

        for lnk in all_links:
            ld = link_to_dict(lnk)
            if lnk.to_task_id == task_id:
                source = read_task(session, lnk.from_task_id)
                if source:
                    ld["from_task"] = task_to_dict(source)
                incoming.append(ld)
            if lnk.from_task_id == task_id:
                target = read_task(session, lnk.to_task_id)
                if target:
                    ld["to_task"] = task_to_dict(target)
                outgoing.append(ld)

        return {
            "task": task_to_dict(task),
            "incoming": incoming,
            "outgoing": outgoing,
        }
    finally:
        session.close()


@mcp.tool()
def mcp_search_tasks(
    ctx: Context,
    query: str,
    search_in: str = "title",
) -> list[dict[str, Any]]:
    """Search tasks by keyword.

    `query` — search keyword (case-insensitive substring match).
    `search_in` — "title" (default), "tags", "description", or "all".
    """
    _require_user()
    session = next(_db_session())
    try:
        all_tasks = list_tasks(session)
        results: list[dict[str, Any]] = []
        q = query.lower()

        for t in all_tasks:
            matched = False
            if search_in in ("title", "all"):
                if q in t.title.lower():
                    matched = True
            if not matched and search_in in ("tags", "all"):
                if any(q in tag.lower() for tag in (t.tags or [])):
                    matched = True
            if not matched and search_in in ("description", "all"):
                if t.description and q in t.description.lower():
                    matched = True
            if matched:
                results.append(task_to_dict(t))

        return results
    finally:
        session.close()


# ═══════════════════════════════════════════════════════════════════════════════
# Audit Tool
# ═══════════════════════════════════════════════════════════════════════════════


@mcp.tool()
def mcp_list_audit_logs(
    ctx: Context,
    entity_type: str | None = None,
    entity_id: int | None = None,
    action: str | None = None,
    limit: int = 50,
) -> list[dict[str, Any]]:
    """List audit logs, newest first.

    `entity_type` filter: "task" or "link".
    `action` filter: "create", "update", or "delete".
    `limit` — max entries (default 50).
    """
    _require_user()
    session = next(_db_session())
    try:
        logs = list_audit_logs(
            session,
            entity_type=entity_type,
            entity_id=entity_id,
            action=action,
            limit=limit,
        )
        results: list[dict[str, Any]] = []
        for a in logs:
            results.append({
                "id": a.id,
                "entity_type": a.entity_type,
                "entity_id": a.entity_id,
                "action": a.action,
                "old_snapshot": json.loads(a.old_snapshot) if a.old_snapshot else None,
                "new_snapshot": json.loads(a.new_snapshot) if a.new_snapshot else None,
                "timestamp": a.timestamp.isoformat() if a.timestamp else None,
            })
        return results
    finally:
        session.close()


# ── FastAPI integration ───────────────────────────────────────────────────────

def mount_mcp(app: FastAPI) -> None:
    """Mount the MCP server on a FastAPI app under /mcp."""
    mcp_app = mcp.streamable_http_app()
    app.mount("/mcp", app=mcp_app)
