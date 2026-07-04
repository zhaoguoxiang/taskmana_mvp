"""
Task Graph Management System — Data Model

Defines all SQLModel entities, enums, and helper types for the MVP.
Schema follows the design doc §3 (Task entity), §5 (Links), §6 (State machine).
"""

from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum
from typing import Optional,List

from sqlmodel import SQLModel, Field, JSON
from sqlalchemy import Column, Integer, ForeignKey



class TaskType(str, Enum):
    EXECUTION = "execution"
    COMMUNICATION = "communication"
    COMPOSITE = "composite"



class TaskStatus(str, Enum):
    TODO = "todo"
    IN_PROGRESS = "in_progress"
    BLOCKED = "blocked"
    DONE = "done"
    CANCELLED = "cancelled"
    PAUSED = "paused"


class LinkType(str, Enum):
    CONTAINS = "contains"       # parent → child (task decomposition)
    BLOCKS = "blocks"           # upstream blocks downstream (hard dependency)
    DERIVES = "derives"         # source task produced this task



class Task(SQLModel, table=True):

    # ── Identity ──
    id: int = Field(default=None, primary_key=True)
    title: str
    task_type: TaskType = Field(default=TaskType.EXECUTION)
    tags: List[str] = Field(default= [],sa_type=JSON)
    description: Optional[str] = Field(default=None)
    source: Optional[str] = Field(default=None)

    # ── Status ──
    status: TaskStatus = Field(default=TaskStatus.TODO)

    # ── Time ──
    deadline: Optional[datetime] = Field(default=None)
    duration: Optional[int] = Field(default=None, ge=0)  # minutes

    # ── People & Location ──
    people: List[str] = Field(default= [],sa_type=JSON)
    location: Optional[str] = Field(default=None)

    # ── Plan / log / review ──
    plan: Optional[str] = Field(default=None)
    log: Optional[str] = Field(default=None) 
    review: Optional[str] = Field(default=None)

    # ── Timestamps ──
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class Link(SQLModel, table=True):

    id: int = Field(default=None, primary_key=True)
    from_task_id: int = Field(
        sa_column=Column(Integer, ForeignKey("task.id", ondelete="CASCADE"), nullable=False)
    )
    to_task_id: int = Field(
        sa_column=Column(Integer, ForeignKey("task.id", ondelete="CASCADE"), nullable=False)
    )
    link_type: LinkType

    # ── Audit / lifecycle ──
    note: Optional[str] = Field(default=None)
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class AuditLog(SQLModel, table=True):

    id: int = Field(default=None, primary_key=True)
    entity_type: str       # "task" | "link"
    entity_id: int
    action: str            # "create" | "update" | "delete"
    old_snapshot: Optional[str] = Field(default=None)  # JSON string, null for create
    new_snapshot: Optional[str] = Field(default=None)  # JSON string, null for delete
    timestamp: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class User(SQLModel, table=True):
    """Single-user authentication table.  Managed via cli.py, not public API."""

    __tablename__ = "user"

    id: int = Field(default=None, primary_key=True)
    username: str = Field(unique=True, index=True)
    password_hash: str
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
