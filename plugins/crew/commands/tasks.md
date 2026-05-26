---
description: View and manage the shared crew task board (add / claim / complete)
allowed-tools: ["Bash"]
---

Manage the shared task board based on: $ARGUMENTS — run the crew CLI:

- No arguments → `node "${CLAUDE_PLUGIN_ROOT}/cli.js" tasks`
- `add: <title>` → `node "${CLAUDE_PLUGIN_ROOT}/cli.js" task-add <title>`
- `claim <id>` → `node "${CLAUDE_PLUGIN_ROOT}/cli.js" task-claim <id>`
- `done <id>` → `node "${CLAUDE_PLUGIN_ROOT}/cli.js" task-done <id>`

Always finish by running `node "${CLAUDE_PLUGIN_ROOT}/cli.js" tasks` and showing the board.
