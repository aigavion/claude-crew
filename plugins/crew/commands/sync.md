---
description: Pull any pending peer messages now and check your changes for collisions
allowed-tools: ["Bash"]
---

1. Run `node "${CLAUDE_PLUGIN_ROOT}/cli.js" inbox` and relay any messages to the user.
2. Run `node "${CLAUDE_PLUGIN_ROOT}/cli.js" check` to see whether your current changes overlap files peers are touching.

Summarize both. If there are collisions, recommend coordinating via `/crew:say` or pulling/rebasing before you push.
