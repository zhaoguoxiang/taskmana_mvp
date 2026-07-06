"""
FastAPI application — REST API for Task and Link CRUD.

Protected endpoints (require Bearer token):
  Task:  GET /tasks  POST /tasks  GET/PATCH/DELETE /tasks/{id}
  Link:  GET /links  POST /links  GET/PATCH/DELETE /links/{id}
  Audit: GET /audit  GET /audit/{id}
  Image: POST /api/images

Public endpoints:
  POST /auth/login  GET /auth/me  GET /
"""

from __future__ import annotations

import contextlib
import uuid
from collections.abc import AsyncIterator
from datetime import datetime
from pathlib import Path

from fastapi import FastAPI, Depends, HTTPException, UploadFile, File, Request
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel
from slowapi import Limiter
from slowapi.util import get_remote_address
from slowapi.middleware import SlowAPIMiddleware
from sqlmodel import Session

from database import get_session
from model import Task, Link, AuditLog, User, TaskStatus, TaskType, LinkType
from service import (
    create_task,
    list_tasks,
    read_task,
    update_task,
    delete_task,
    create_link,
    list_links,
    read_link,
    update_link,
    delete_link,
    list_audit_logs,
    read_audit_log,
)
from audit import task_to_dict, link_to_dict
from auth import (
    get_current_user,
    get_optional_user,
    hash_password,
    verify_password,
    create_access_token,
    UserLogin,
    UserResponse,
)
from mcp_serve import mount_mcp, MCPAuthMiddleware, mcp

app = FastAPI(
    title="TaskMana MVP",
    description="Graph-based task management — tasks are nodes, links are edges.",
    version="0.1.0",
)

# ── Rate limiter ─────────────────────────────────────────────────────────────

limiter = Limiter(key_func=get_remote_address)
app.state.limiter = limiter
app.add_middleware(SlowAPIMiddleware)

# ── Static files ──────────────────────────────────────────────────────────────

STATIC_DIR = Path(__file__).resolve().parent / "static"
UPLOADS_DIR = STATIC_DIR / "uploads"
UPLOADS_DIR.mkdir(parents=True, exist_ok=True)

ALLOWED_IMAGE_TYPES = {
    "image/png", "image/jpeg", "image/gif", "image/webp", "image/svg+xml",
}
MAX_UPLOAD_SIZE = 10 * 1024 * 1024  # 10 MB

app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")


@app.get("/")
def serve_spa():
    """Serve the SPA entry point."""
    return FileResponse(STATIC_DIR / "index.html")


# ── Schemas ────────────────────────────────────────────────────────────────────


class TaskCreate(BaseModel):
    title: str
    description: str | None = None
    task_type: TaskType = TaskType.EXECUTION
    tags: list[str] = []
    source: str | None = None
    status: TaskStatus = TaskStatus.TODO
    deadline: datetime | None = None
    duration: int | None = None
    people: list[str] = []
    location: str | None = None
    plan: str | None = None
    log: str | None = None
    review: str | None = None


class TaskUpdate(BaseModel):
    title: str | None = None
    description: str | None = None  # unchanged, both optional on update
    task_type: TaskType | None = None
    tags: list[str] | None = None
    source: str | None = None
    status: TaskStatus | None = None
    deadline: datetime | None = None
    duration: int | None = None
    people: list[str] | None = None
    location: str | None = None
    plan: str | None = None
    log: str | None = None
    review: str | None = None


class LinkCreate(BaseModel):
    from_task_id: int
    to_task_id: int
    link_type: LinkType
    note: str | None = None


class LinkUpdate(BaseModel):
    link_type: LinkType | None = None
    note: str | None = None


# ── Auth ──────────────────────────────────────────────────────────────────────


@app.post("/auth/login")
@limiter.limit("5/minute")
def api_login(
    request: Request,
    body: UserLogin,
    session: Session = Depends(get_session),
):
    """POST — authenticate and receive a JWT Bearer token.

    Rate limited to 5 attempts per minute per IP.
    """
    from sqlmodel import select as _select
    user = session.exec(_select(User).where(User.username == body.username)).first()
    if user is None or not verify_password(body.password, user.password_hash):
        raise HTTPException(401, "Invalid username or password")

    token = create_access_token(data={"sub": str(user.id)})
    return {
        "access_token": token,
        "token_type": "bearer",
        "user": UserResponse(
            id=user.id,
            username=user.username,
            created_at=user.created_at.isoformat() if user.created_at else "",
        ).model_dump(),
    }


@app.get("/auth/me")
def api_me(current_user: User = Depends(get_current_user)):
    """GET — return the current authenticated user's info."""
    return UserResponse(
        id=current_user.id,
        username=current_user.username,
        created_at=current_user.created_at.isoformat() if current_user.created_at else "",
    ).model_dump()


# ── Response helpers ───────────────────────────────────────────────────────────


# Serialization helpers are imported from audit.py (single source of truth).
_task_dict = task_to_dict
_link_dict = link_to_dict


# ── Task CRUD ──────────────────────────────────────────────────────────────────


@app.get("/tasks")
def api_list_tasks(
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    """GET — list all tasks, newest first."""
    return [_task_dict(t) for t in list_tasks(session)]


@app.get("/tasks/{task_id}")
def api_read_task(
    task_id: int,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    """GET — read a task by id."""
    task = read_task(session, task_id)
    if task is None:
        raise HTTPException(404, "Task not found")
    return _task_dict(task)


@app.post("/tasks", status_code=201)
def api_create_task(
    body: TaskCreate,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    """POST — create a new task."""
    task = create_task(session, **body.model_dump())
    return _task_dict(task)


@app.patch("/tasks/{task_id}")
def api_update_task(
    task_id: int,
    body: TaskUpdate,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    """PATCH — update mutable fields on a task."""
    fields = {k: v for k, v in body.model_dump().items() if v is not None}
    if not fields:
        raise HTTPException(400, "No fields to update")
    task = update_task(session, task_id, **fields)
    if task is None:
        raise HTTPException(404, "Task not found")
    return _task_dict(task)


@app.delete("/tasks/{task_id}")
def api_delete_task(
    task_id: int,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    """DELETE — hard-delete a task and all its links."""
    ok = delete_task(session, task_id)
    if not ok:
        raise HTTPException(404, "Task not found")
    return {"deleted": True, "task_id": task_id}


# ── Link CRUD ──────────────────────────────────────────────────────────────────


@app.get("/links")
def api_list_links(
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    """GET — list all links, newest first."""
    return [_link_dict(lnk) for lnk in list_links(session)]


# ── Audit CRUD ────────────────────────────────────────────────────────────────


class AuditLogResponse(BaseModel):
    id: int
    entity_type: str
    entity_id: int
    action: str
    old_snapshot: dict | None = None
    new_snapshot: dict | None = None
    timestamp: str


def _audit_dict(a: AuditLog) -> dict:
    import json
    return {
        "id": a.id,
        "entity_type": a.entity_type,
        "entity_id": a.entity_id,
        "action": a.action,
        "old_snapshot": json.loads(a.old_snapshot) if a.old_snapshot else None,
        "new_snapshot": json.loads(a.new_snapshot) if a.new_snapshot else None,
        "timestamp": a.timestamp.isoformat() if a.timestamp else None,
    }


@app.get("/audit")
def api_list_audit_logs(
    entity_type: str | None = None,
    entity_id: int | None = None,
    action: str | None = None,
    limit: int = 100,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    """GET — list audit logs, newest first.  Filter by entity_type, entity_id, action."""
    logs = list_audit_logs(
        session,
        entity_type=entity_type,
        entity_id=entity_id,
        action=action,
        limit=limit,
    )
    return [_audit_dict(a) for a in logs]


@app.get("/audit/{audit_id}")
def api_read_audit_log(
    audit_id: int,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    """GET — read a single audit log by id."""
    log = read_audit_log(session, audit_id)
    if log is None:
        raise HTTPException(404, "Audit log not found")
    return _audit_dict(log)


@app.get("/links/{link_id}")
def api_read_link(
    link_id: int,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    """GET — read a link by id."""
    link = read_link(session, link_id)
    if link is None:
        raise HTTPException(404, "Link not found")
    return _link_dict(link)


@app.post("/links", status_code=201)
def api_create_link(
    body: LinkCreate,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    """POST — create a link between two tasks."""
    link, err = create_link(session, **body.model_dump())
    if err:
        status = 409 if "already exists" in err or "Cannot" in err else 404
        raise HTTPException(status, err)
    return _link_dict(link)


@app.patch("/links/{link_id}")
def api_update_link(
    link_id: int,
    body: LinkUpdate,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    """PATCH — update a link's type or note."""
    link = update_link(session, link_id, link_type=body.link_type, note=body.note)
    if link is None:
        raise HTTPException(404, "Link not found")
    return _link_dict(link)


@app.delete("/links/{link_id}")
def api_delete_link(
    link_id: int,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    """DELETE — hard-delete a link."""
    link, err = delete_link(session, link_id)
    if err:
        raise HTTPException(404, err)
    return {"deleted": True, "link_id": link_id}


# ── Image Upload ──────────────────────────────────────────────────────────────


@app.post("/api/images")
async def api_upload_image(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
):
    """POST — upload an image for use in Markdown fields.

    Returns {"url": "/static/uploads/<uuid>.<ext>"}.
    Max file size: 10 MB.  Allowed types: PNG, JPEG, GIF, WebP, SVG.
    """
    if file.content_type not in ALLOWED_IMAGE_TYPES:
        raise HTTPException(400, f"Unsupported image type: {file.content_type}")

    contents = await file.read()
    if len(contents) > MAX_UPLOAD_SIZE:
        raise HTTPException(400, "File too large (max 10 MB)")

    ext = file.filename.rsplit(".", 1)[-1].lower() if file.filename and "." in file.filename else "png"
    if ext not in ("png", "jpg", "jpeg", "gif", "webp", "svg"):
        ext = "png"

    filename = f"{uuid.uuid4().hex}.{ext}"
    filepath = UPLOADS_DIR / filename
    filepath.write_bytes(contents)

    return {"url": f"/static/uploads/{filename}"}


# ── MCP Server integration ────────────────────────────────────────────────────


@contextlib.asynccontextmanager
async def _app_lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Lifespan that manages the MCP session manager lifecycle."""
    async with mcp.session_manager.run():
        yield


app.router.lifespan_context = _app_lifespan

# Mount MCP server — this is a Starlette sub-app under /mcp.
mount_mcp(app)

# Add JWT auth middleware for MCP endpoints (validates Bearer on /mcp paths).
app.add_middleware(MCPAuthMiddleware)
