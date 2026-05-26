---
description: View and manage the shared crew task board (add / claim / complete)
allowed-tools:
  [
    "mcp__plugin_crew_crew__crew_tasks_list",
    "mcp__plugin_crew_crew__crew_task_add",
    "mcp__plugin_crew_crew__crew_task_claim",
    "mcp__plugin_crew_crew__crew_task_update",
  ]
---

Help the user with the shared task board based on: $ARGUMENTS

- No arguments → call `crew_tasks_list` and summarize what's open vs claimed vs done.
- `add: <title>` → create it with `crew_task_add`.
- `claim <id>` → claim it with `crew_task_claim` (report if a peer beat you to it).
- `done <id>` → mark it done with `crew_task_update` (status `done`).

Always finish by showing the current board.
