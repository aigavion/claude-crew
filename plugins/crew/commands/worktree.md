---
description: Create an isolated git worktree + branch for a new crew member to work in
allowed-tools: ["Bash"]
---

Create a fresh, isolated workspace so another instance can work in parallel without
clobbering files on disk. If `$ARGUMENTS` is empty, ask the user for a short name first.

Otherwise run this and show the output:

`node "${CLAUDE_PLUGIN_ROOT}/cli.js" worktree "$ARGUMENTS"`

Then tell the user to open a new terminal, `cd` into the printed worktree path, run
`claude`, and `/crew:join $ARGUMENTS` there. That new instance will show up in everyone's roster automatically.
