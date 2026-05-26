---
description: Pull any pending peer messages now and check your changes for collisions
allowed-tools:
  ["mcp__plugin_crew_crew__crew_inbox", "mcp__plugin_crew_crew__crew_check_collisions"]
---

1. Call `crew_inbox` and relay any messages peers have sent you.
2. Call `crew_check_collisions` to see whether your current changes overlap files peers are touching.

Summarize both results. If there are collisions, recommend coordinating via `/crew:say` or pulling/rebasing before you push.
