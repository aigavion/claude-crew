---
description: Send a message to your crew peers (broadcast, or "@name message" to direct-message)
allowed-tools: ["Bash"]
---

Send a message to the crew based on: $ARGUMENTS

- If it starts with `@name`, direct-message that peer — run:
  `node "${CLAUDE_PLUGIN_ROOT}/cli.js" dm <name> <the rest of the text>`
- Otherwise broadcast to everyone — run:
  `node "${CLAUDE_PLUGIN_ROOT}/cli.js" say <text>`

Show the user the confirmation it prints.
