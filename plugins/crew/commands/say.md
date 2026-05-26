---
description: Send a message to your crew peers (broadcast, or "@name message" to direct-message)
allowed-tools: ["mcp__plugin_crew_crew__crew_say"]
---

Send a message to the crew using the `crew_say` tool, based on: $ARGUMENTS

- If the text starts with `@name`, direct-message that peer: pass `to` = the name and `message` = the rest.
- Otherwise broadcast to everyone (omit `to`).

Then confirm to the user exactly what was sent and to whom.
