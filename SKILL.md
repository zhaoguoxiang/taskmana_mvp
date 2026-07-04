---
name: taskmana
description: >-
  TaskMana graph-based task management — tasks are nodes, links are edges.
  Use when the user wants to create, query, update, or delete tasks and links;
  manage kanban (todo/in_progress/blocked/done/cancelled/paused) task status;
  build or inspect a task dependency graph (contains, blocks, derives);
  search tasks by title, tags, or description; view audit logs;
  or do any task planning, project tracking, or workflow management.
  Triggers: 任务, 看板, task, todo, kanban, graph, 任务图, GTD, 项目管理,
  创建任务, 删除任务, 更新任务, 任务状态, 阻塞, 依赖, 审计日志, TaskMana.
---

# TaskMana — Graph-based Task Management

## Concepts

TaskMana models work as a **directed graph**: tasks are **nodes**, relationships are **edges**.  
Every task lives in a Kanban board organized by status, and the graph view reveals dependencies.

### Task

A task is the fundamental unit of work.  Key fields:

| Field | Type | Notes |
|-------|------|-------|
| `id` | int | Auto-generated primary key |
| `title` | str | **Required**.  Keep it concise and actionable. |
| `description` | str | Optional long-form detail (Markdown supported in the UI). |
| `task_type` | enum | `execution` (🔨 actionable work), `communication` (💬 sync/meeting), `composite` (📦 parent of sub-tasks) |
| `status` | enum | Kanban column: `todo`, `in_progress`, `blocked`, `done`, `cancelled`, `paused` |
| `tags` | list[str] | Free-form labels, e.g. `["urgent", "backend"]` |
| `source` | str | Where the task originated (meeting, email, ticket ref, etc.) |
| `deadline` | datetime | ISO-8601 string, e.g. `"2026-07-10T18:00:00"` |
| `duration` | int | Estimated minutes |
| `people` | list[str] | Names of people involved |
| `location` | str | Physical or virtual place |
| `plan` | str | Markdown plan content |
| `log` | str | Markdown execution log |
| `review` | str | Markdown retrospective / review |

### Link (Edge)

A directed edge between two tasks.  Three link types model different semantics:

| `link_type` | Meaning | Direction |
|-------------|---------|-----------|
| `contains` | Parent → child (task decomposition).  A composite task **contains** sub-tasks. | parent → child |
| `blocks` | Hard dependency.  The source **blocks** the target — target can't start until source is done. | blocker → blocked |
| `derives` | Origin relationship.  A source task **produced** the derived task. | source → derived |

| Field | Type | Notes |
|-------|------|-------|
| `id` | int | Auto-generated |
| `from_task_id` | int | Source task (required) |
| `to_task_id` | int | Target task (required) |
| `link_type` | str | `contains`, `blocks`, or `derives` |
| `note` | str | Optional annotation |

**Constraints:**  self-loops are rejected; duplicate links (same from/to/type) are rejected; both tasks must exist.

### Audit Log

Every create / update / delete on Task or Link is automatically recorded with full before/after snapshots.

### Status State Machine

```
todo ──→ in_progress ──→ done
 │           │
 ├──→ blocked           ├──→ paused
 └──→ cancelled         └──→ cancelled
```

## Available MCP Tools

All tools require JWT Bearer authentication.  If a tool returns an `error` key, check the message and adjust your parameters.

### Task CRUD

**`mcp_list_tasks`** — List all tasks, newest first.  
*No parameters.*  Returns a list of task dicts with summary fields (id, title, status, task_type, tags, deadline, people).

**`mcp_get_task`** — Get full details of one task.  
*Parameters:* `task_id` (int, required).  Returns the complete task dict.

**`mcp_create_task`** — Create a new task.  
*Parameters:*

| Param | Type | Required | Default | Notes |
|-------|------|----------|---------|-------|
| `title` | str | **Yes** | — | Keep concise and actionable |
| `description` | str | No | `None` | Markdown supported |
| `task_type` | str | No | `"execution"` | `execution` / `communication` / `composite` |
| `tags` | list[str] | No | `[]` | Free-form labels |
| `source` | str | No | `None` | Origin reference |
| `status` | str | No | `"todo"` | `todo` / `in_progress` / `blocked` / `done` / `cancelled` / `paused` |
| `deadline` | str | No | `None` | ISO-8601, e.g. `"2026-07-10T18:00:00"` |
| `duration` | int | No | `None` | Minutes |
| `people` | list[str] | No | `[]` | Names |
| `location` | str | No | `None` | Place |
| `plan` | str | No | `None` | Markdown |
| `log` | str | No | `None` | Markdown |
| `review` | str | No | `None` | Markdown |

**`mcp_update_task`** — Update fields on a task.  Only the fields you pass are changed; omit fields to leave them unchanged.  
*Parameters:* `task_id` (int, required) + any subset of the create-task fields above, all optional except `task_id`.

**`mcp_delete_task`** — Hard-delete a task and all its associated links.  
*Parameters:* `task_id` (int, required).  Returns `{"deleted": true, "task_id": N}`.

### Link CRUD

**`mcp_list_links`** — List all links, newest first.  
*No parameters.*

**`mcp_get_link`** — Get a single link by ID.  
*Parameters:* `link_id` (int, required).

**`mcp_create_link`** — Create a link between two tasks.  
*Parameters:*

| Param | Type | Required | Notes |
|-------|------|----------|-------|
| `from_task_id` | int | **Yes** | Source task |
| `to_task_id` | int | **Yes** | Target task |
| `link_type` | str | **Yes** | `contains` / `blocks` / `derives` |
| `note` | str | No | Annotation |

**`mcp_delete_link`** — Hard-delete a link by ID.  
*Parameters:* `link_id` (int, required).

### Graph & Query

**`mcp_get_task_graph`** — Return the full graph: `{"tasks": [...], "links": [...]}`.  
*No parameters.*  Use this to understand the entire project structure at once, or to feed a visualization.

**`mcp_get_related_tasks`** — Get a task and all directly connected tasks, grouped by direction.  
*Parameters:* `task_id` (int, required).  
Returns `{"task": {...}, "incoming": [...], "outgoing": [...]}`.

**`mcp_search_tasks`** — Full-text search across tasks.  
*Parameters:*

| Param | Type | Required | Default | Notes |
|-------|------|----------|---------|-------|
| `query` | str | **Yes** | — | Case-insensitive substring match |
| `search_in` | str | No | `"title"` | `title` / `tags` / `description` / `all` |

### Audit

**`mcp_list_audit_logs`** — Query audit trail, newest first.  
*Parameters:* `entity_type` (str, optional: `"task"` or `"link"`), `entity_id` (int, optional), `action` (str, optional: `"create"` / `"update"` / `"delete"`), `limit` (int, default 50).

## Common Workflows

### 1. Quick task dump / status check
```
mcp_list_tasks → scan titles, statuses, and deadlines
```

### 2. Create a task with full context
```
mcp_create_task(title="...", description="...", task_type="execution", tags=["..."], status="todo", deadline="...", people=["..."])
```

### 3. Build a task hierarchy (composite → sub-tasks)
```
mcp_create_task → mcp_create_task → mcp_create_link(from=parent, to=child, link_type="contains")
```

### 4. Model a blocker dependency
```
mcp_create_link(from_task_id=blocker_id, to_task_id=blocked_id, link_type="blocks", note="waiting for API to be ready")
```
When the blocker is resolved: `mcp_update_task(task_id=blocker_id, status="done")` then `mcp_update_task(task_id=blocked_id, status="todo")`.

### 5. Explore what's blocking a task
```
mcp_get_related_tasks(task_id) → inspect incoming links with link_type="blocks"
```

### 6. Review recent activity
```
mcp_list_audit_logs(limit=20) → see who changed what, when
```

### 7. Search and triage
```
mcp_search_tasks(query="urgent") → find all urgent tasks
mcp_search_tasks(query="backend", search_in="tags") → find backend-tagged tasks
mcp_search_tasks(query="deploy", search_in="all") → search everywhere
```

### 8. Kanban-style status review
```
mcp_list_tasks → group by status field → report: "3 todo, 2 in_progress, 1 blocked, 5 done"
```

## Best Practices

- **Titles are actions.**  Prefer `"Draft Q3 roadmap"` over `"Q3 roadmap"`.
- **Use `blocks` judiciously.**  Only mark true hard dependencies where work literally cannot proceed.  Over-blocking creates a fragile graph.
- **`contains` for decomposition.**  Break large tasks into sub-tasks linked with `contains`.  The parent should be `composite` type.
- **`derives` for traceability.**  When a meeting or discussion spawns a new task, link the source task (often `communication` type) to the derived task.
- **Check before linking.**  Use `mcp_get_task` to verify both tasks exist before calling `mcp_create_link`.
- **Delete is irreversible.**  `mcp_delete_task` cascades to all links; there is no undo (only audit log for forensic recovery).
- **Audit log is your safety net.**  If you need to know what changed, `mcp_list_audit_logs` has the full before/after snapshots.
- **Search in `all` for discovery.**  When unsure where a keyword might appear, default to `search_in="all"`.
- **Deadlines in ISO-8601.**  Always use `"YYYY-MM-DDTHH:MM:SS"` format.  Timezone-aware strings are accepted.
