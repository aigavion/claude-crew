# crew — coordinate multiple Claude Code instances

Run two or three Claude Code instances on the same project and they stop being blind
to each other. **crew** gives independently-launched instances a shared task board,
a background message channel, and a commit-time collision guard — so they divide
work instead of duplicating it, and warn each other before they clobber the same
files.

Unlike Claude Code's built-in [agent teams](https://code.claude.com/docs/en/agent-teams)
(one fixed "lead" that spawns workers, tmux-only split panes), crew is **peer-based**:
you open your own terminals, and each instance discovers the others automatically. No
lead, no tmux, works on Windows/macOS/Linux. **Zero runtime dependencies** — just Node.

---

## How it works

```
Instance A (its own worktree)        Instance B (its own worktree)
  hooks + crew MCP server  ─┐        ┌─  hooks + crew MCP server
                            ▼        ▼
                 Broker daemon (127.0.0.1, ephemeral port)
                 presence · messages · task board · file claims
                 store keyed by `git rev-parse --git-common-dir`
                 → every worktree of one repo shares one broker
```

- **Discovery is automatic.** Each instance is keyed to the repo via
  `git --git-common-dir`, which is identical across all of a repo's worktrees. The
  first instance spawns a tiny localhost broker; the rest find it. State lives in your
  OS temp dir (never in the plugin cache), localhost-only.
- **Messages arrive without polling.** Claude Code is turn-based — an instance only
  "hears" peers at hook checkpoints. crew uses three: `SessionStart` injects the
  roster, `UserPromptSubmit` flushes queued messages when you type, and `Stop` briefly
  waits and — if a peer messaged you — keeps the instance going one more turn to handle
  it. (Loop-guarded, so an idle instance always settles.)
- **Collisions are caught at commit.** A `PreToolUse` hook watches `git commit/push/
  merge`, compares your changed files against what peers are touching, and warns you
  (or asks, or blocks — your choice) when they overlap or your branch is behind.

## Install

```shell
/plugin marketplace add aigavion/claude-crew
/plugin install crew@crew-marketplace
```

Requires Node 18+ on your PATH (same Node that runs the plugin's hooks).

## Recommended workflow

Each instance should work in its **own git worktree** so they never overwrite files on
disk — collisions then become a clean git-merge concern, which is exactly what the
commit guard helps with.

1. In your first Claude Code session on the repo, create an isolated workspace per teammate:
   ```
   /crew:worktree alice
   /crew:worktree bob
   ```
   Each prints a path. node_modules are linked from your main checkout (junction on
   Windows, symlink elsewhere) so there's no full reinstall.
2. Open a new terminal per worktree, `cd` into it, run `claude`, and `/crew:join alice`.
3. Build in parallel. They share a task board, can message each other, and get warned
   on overlapping commits.

> You can also just open multiple `claude` sessions in the **same** folder — but two
> instances saving the same file at once will overwrite each other on disk (no tool can
> prevent that). Worktrees avoid it. Same-folder instances also share one peer identity,
> so worktrees are the supported multi-instance mode.

## Commands

| Command | What it does |
| :-- | :-- |
| `/crew:join [name]` | Name this instance and show who else is active |
| `/crew:status` | Roster + shared task board + unread count |
| `/crew:say <msg>` | Message the crew (`@name msg` to direct-message) |
| `/crew:tasks` | View / `add:` / `claim <id>` / `done <id>` on the board |
| `/crew:sync` | Pull pending messages and run a collision check now |
| `/crew:worktree <name>` | Create an isolated worktree + branch for a new member |
| `/crew:leave` | Deregister this instance; print worktree-cleanup tips |

## Tools (model-callable)

Claude can call these on its own to coordinate mid-task: `crew_roster`, `crew_say`,
`crew_inbox`, `crew_tasks_list`, `crew_task_add`, `crew_task_claim`, `crew_task_update`,
`crew_declare_files`, `crew_check_collisions`.

## Configuration

Optional `.claude-crew.local.md` in your repo root (YAML frontmatter), or environment
variables:

```markdown
---
collisionMode: warn        # warn | ask | block  (what the commit guard does on overlap)
peerScope: repo            # repo | cwd | machine (who counts as a peer)
nodeModulesStrategy: link  # link | install | skip
worktreeBaseDir: .crew-worktrees
displayName:               # override this instance's name
stopWaitMs: 1500           # how long Stop waits for late messages
---
```

Env equivalents: `CREW_COLLISION_MODE`, `CREW_PEER_SCOPE`, `CREW_NAME`,
`CREW_NODE_MODULES`, `CREW_WORKTREE_DIR`, `CREW_STOP_WAIT_MS`.

## Limitations (by design)

- Coordination happens at hook checkpoints, not mid-thought — an instance fully idle
  (waiting on you) sees new messages when you next type, or right as it stops.
- One peer identity per working directory → run separate instances in separate worktrees.
- The commit guard defaults to **warn**; it never silently blocks your git unless you set
  `collisionMode: block`.
- The broker is localhost-only and shuts down ~a minute after the last instance leaves.

## Development

```shell
node plugins/crew/test/smoke.mjs      # broker + client + tasks + collisions
node plugins/crew/test/mcp-test.mjs   # MCP JSON-RPC handshake + tools
claude plugin validate .              # marketplace
claude plugin validate plugins/crew   # plugin
```

Test a local checkout without installing:

```shell
claude --plugin-dir ./plugins/crew
```

## License

MIT
