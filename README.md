# crew — coordinate multiple Claude Code instances

Open Claude Code in two or three terminals on the same project and they stop being
blind to each other. **crew** auto-connects them as peers: they share a task board,
message each other in the background, and warn each other before they clobber the same
files at commit time.

No lead, no tmux, no flags, no setup. Works on Windows/macOS/Linux. **Zero runtime
dependencies** — just Node.

Unlike Claude Code's built-in [agent teams](https://code.claude.com/docs/en/agent-teams)
(one fixed "lead" that spawns workers), crew is **peer-based**: you open your own
terminals and each instance discovers the others on its own.

---

## Quick start

```shell
/plugin marketplace add aigavion/claude-crew
/plugin install crew@crew-marketplace
```

Then just open Claude in the same repo, in as many terminals as you want:

```shell
# terminal 1
claude
# terminal 2
claude
```

They connect automatically — each terminal is its own peer (even in the same folder).
`/crew` shows who's online. That's the whole setup.

Optional niceties:
- **`/crew Bob`** — give this instance a friendly name (otherwise it's auto-named).
- Heavy parallel editing? Give each instance its own worktree so they can't clobber
  files on disk — see [Worktrees](#worktrees-for-heavy-parallel-editing) below.

## How it works

```
Terminal A (session abc…)            Terminal B (session xyz…)
  crew hooks  ─────────┐              ┌───────── crew hooks
                       ▼              ▼
            Broker daemon (127.0.0.1, ephemeral port)
            presence · messages · task board · file claims
            store keyed by `git rev-parse --git-common-dir`
```

- **Identity is per session.** Every hook gets a `session_id` that's unique to its
  terminal, so two instances in the *same folder* are still distinct peers. The first
  instance spawns a tiny localhost broker (state in your OS temp dir, never in the
  plugin cache); the rest find it. Discovery is scoped to the repo via
  `git --git-common-dir`, which is shared across all of a repo's worktrees.
- **Messages arrive without polling.** Claude Code is turn-based, so crew delivers at
  hook checkpoints: `SessionStart` connects you and shows the roster, `UserPromptSubmit`
  flushes queued messages when you type, and `Stop` briefly waits and — if a peer
  messaged you — keeps the instance going one more turn to handle it (loop-guarded).
- **Collisions are caught at commit.** A `PreToolUse` hook watches `git commit/push/
  merge`, compares your changed files against what peers are touching, and warns you
  (or asks, or blocks — your choice) when they overlap or your branch is behind.

## Commands

| Command | What it does |
| :-- | :-- |
| `/crew [name]` | Show the roster / give this instance a name *(personal alias, see below)* |
| `/crew:join [name]` | Same, shipped with the plugin |
| `/crew:status` | Roster + shared task board + unread count |
| `/crew:say <msg>` | Message the crew (`@name msg` to direct-message) |
| `/crew:tasks` | View / `add:` / `claim <id>` / `done <id>` on the board |
| `/crew:sync` | Pull pending messages and run a collision check now |
| `/crew:worktree <name>` | Create an isolated worktree + branch for a new member |
| `/crew:leave` | Disconnect this instance; print worktree-cleanup tips |

Claude can also coordinate on its own initiative — the SessionStart message tells it how
to message peers and use the task board via the bundled CLI.

> **Bare `/crew`:** plugin commands are namespaced as `/crew:*`. To type just
> `/crew Bob`, add a personal command at `~/.claude/commands/crew.md` that runs
> `node "<checkout>/plugins/crew/cli.js" name "$ARGUMENTS"` (and `... status` when empty).

## Worktrees (for heavy parallel editing)

Same-folder peers coordinate fine, but they share files on disk — if two save the same
file at the same moment, one overwrites the other. When instances will edit a lot in
parallel, give each its own git worktree so that can't happen (collisions become a clean
git-merge concern, which the commit guard handles):

```
/crew:worktree alice      # prints a path; node_modules linked from your main checkout
```
Open a terminal in that path, run `claude`, and it joins the same crew automatically.

## Configuration

Optional `.claude-crew.local.md` in your repo root (YAML frontmatter), or env vars:

```markdown
---
collisionMode: warn        # warn | ask | block  (what the commit guard does on overlap)
peerScope: repo            # repo | cwd | machine (who counts as a peer)
nodeModulesStrategy: link  # link | install | skip
worktreeBaseDir: .crew-worktrees
displayName:               # force this instance's name
stopWaitMs: 1500           # how long Stop waits for late messages
---
```

Env equivalents: `CREW_COLLISION_MODE`, `CREW_PEER_SCOPE`, `CREW_NAME`,
`CREW_NODE_MODULES`, `CREW_WORKTREE_DIR`, `CREW_STOP_WAIT_MS`.

## Limitations (by design)

- Coordination happens at hook checkpoints, not mid-thought — a fully idle instance sees
  new messages when you next type, or right as it stops.
- Same-folder peers share files on disk; use worktrees for heavy parallel editing.
- The commit guard defaults to **warn**; it never blocks your git unless you set
  `collisionMode: block`.
- The broker is localhost-only and shuts down ~a minute after the last instance leaves.

## Development

```shell
node plugins/crew/test/smoke.mjs      # broker + client + tasks + collisions
claude plugin validate plugins/crew   # plugin manifest + components
claude plugin validate .              # marketplace
claude --plugin-dir ./plugins/crew    # load a local checkout without installing
```

## License

MIT
