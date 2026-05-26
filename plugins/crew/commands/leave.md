---
description: Leave the crew (deregister this instance) and get worktree cleanup tips
allowed-tools: ["Bash"]
---

Run this and show the user its output:

`node "${CLAUDE_PLUGIN_ROOT}/cli.js" leave`

If it prints worktree-removal commands, surface them so the user can clean up when they're done.
