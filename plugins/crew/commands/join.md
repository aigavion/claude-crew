---
description: Join the crew under a display name and see which other instances are active
allowed-tools: ["Bash"]
---

Run this command exactly and show the user its output:

`node "${CLAUDE_PLUGIN_ROOT}/cli.js" name "$ARGUMENTS"`

If `$ARGUMENTS` is empty it keeps your current name and just prints the roster.

After running, briefly tell the user who else is on the crew right now, and remind them they can coordinate with `/crew:say`, `/crew:tasks`, `/crew:status`, and `/crew:sync`.
