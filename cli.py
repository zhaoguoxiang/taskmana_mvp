"""
CLI management tool for TaskMana.

Usage:
    uv run python cli.py create-user              Create the admin user (interactive)
    uv run python cli.py create-user --db ./x.db  Custom database path

Environment:
    TASKMANA_DB_PATH — default database path (overridden by --db)
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

from database import init_db, get_engine
from model import User
from auth import hash_password
from sqlmodel import Session, select


def cmd_create_user(db_path: str | None = None) -> None:
    """Interactive user creation.  Single-user mode — rejects if a user already exists."""
    # Ensure DB is set up so the user table exists.
    init_db(db_path)

    engine = get_engine()
    with Session(engine) as session:
        existing = session.exec(select(User)).first()
        if existing:
            print(f"✗ A user already exists: {existing.username}")
            print("  TaskMana is single-user mode. Delete the database to start fresh.")
            sys.exit(1)

        print("Create admin user for TaskMana")
        print("─" * 40)

        while True:
            username = input("Username: ").strip()
            if not username:
                print("✗ Username cannot be empty.")
                continue
            if len(username) < 2:
                print("✗ Username must be at least 2 characters.")
                continue
            break

        while True:
            password = input("Password (min 8 chars): ").strip()
            if len(password) < 8:
                print("✗ Password must be at least 8 characters.")
                continue
            confirm = input("Confirm password: ").strip()
            if password != confirm:
                print("✗ Passwords do not match.")
                continue
            break

        user = User(
            username=username,
            password_hash=hash_password(password),
        )
        session.add(user)
        session.commit()
        session.refresh(user)

        print(f"✓ User '{user.username}' created (id={user.id})")
        print("  Now start the server:  uv run python main.py")


def main() -> None:
    parser = argparse.ArgumentParser(description="TaskMana CLI")
    parser.add_argument("--db", default=os.getenv("TASKMANA_DB_PATH"), help="SQLite database path")
    sub = parser.add_subparsers(dest="command")

    sub.add_parser("create-user", help="Create the admin user")

    args = parser.parse_args()

    if args.command == "create-user":
        cmd_create_user(args.db)
    else:
        parser.print_help()
        sys.exit(1)


if __name__ == "__main__":
    main()
