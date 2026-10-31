# Codex → Cursor delegation policy

This document is the operational companion to the Cursor worker delegation
section in `AGENTS.md`. If they disagree, follow `AGENTS.md`.

## Roles

- **Codex CLI / Luna**: supervisor. Classifies and routes work, decides whether
  Sol advice is required, owns the final design decision, prepares the work
  order, supervises implementation, and reviews the completion report and diff.
- **`sol_supervisor`**: design and investigation adviser for the high-risk
  triggers below. Returns evidence, the required decision, tradeoffs, and a
  bounded implementation plan. Sol does not implement changes or spawn agents.
  Sol review is mandatory before design decisions and before implementation for
  every listed trigger, including when Luna implements that work directly.
- **Cursor CLI**: default implementation worker for ordinary bounded work.
  Performs the assigned code edits, tests, browser verification, and completion
  report. A Cursor worker must not invoke `scripts/delegate-cursor.sh` or
  re-delegate. Follow the repository rules and `.cursor/rules/worker.mdc`.

Sol escalation and implementation ownership are separate decisions. Not
escalating to Sol does not route implementation to Luna.

## Implementation ownership

Cursor is the default implementer for ordinary UI/UX, features, localized bugs,
routine test/lint fixes, and other bounded work with independently verifiable
completion criteria. Delegate that work with `scripts/delegate-cursor.sh`.

Routine UI/CSS, understood local bugs, normal features, lint/test work, and
small refactors need no Sol advice by default, and Cursor still implements
them. Luna clarifies requirements, investigates enough to classify and bound
the task, writes the work order, and reviews the result.

Luna may implement directly when:

- the work is high-risk or spans multiple areas and needs repeated short
  implementation and verification cycles, or
- Cursor delegation is clearly less efficient for that task.

State the concrete reason. A dirty checkout or delegation setup overhead alone
is not a sufficient reason. Luna also implements directly when the user
explicitly assigns the implementation to Luna, and when maintaining the
delegation infrastructure itself.

Do not take ordinary implementation over because delegation takes setup or the
checkout is dirty.

If Cursor CLI is unavailable, the delegate script is broken, or another tooling
failure prevents delegation, report the concrete failure. Do one bounded repair
or retry only when that is efficient. Luna may take over only when the
independent direct-implementation conditions above are met. Tooling failure
alone does not justify takeover, skipping Sol review or quality checks, or
changing the model family.

Quality checks, security review, tests, final diff review, and Git/worktree
safety apply regardless of who implements.

## Sol escalation

Classify the request before broad repository investigation. For a trigger
below, do only the minimum initial check needed to confirm the task context,
then delegate exactly one `sol_supervisor` before design decisions or
implementation. The handoff contains only `task`, `escalation reason`,
`known facts`, and `required decision`.

Escalate early for:

- database schemas or migrations
- authentication, authorization, or security boundaries
- public API contract changes
- CI/CD or deployment
- Docker, nginx, or production infrastructure
- cross-repository changes
- undocumented architecture decisions
- complex bugs spanning multiple areas when the cause is unclear
- a Cursor `hard` implementation attempt that failed due to design or
  implementation difficulty and now needs redesign

Do not escalate routine UI/CSS, local bugs with an understood cause, normal
feature implementation, lint/test work, or small refactors.

After a Sol handoff, do not start another Sol subagent for the same decision.
If the scope changes materially and a new independent high-risk decision
arises, Luna may make a fresh escalation decision.

## Cursor tiers

Use the fixed tier mapping through the delegation script, with `normal` by
default:

| Tier | Model | Typical work |
|---|---|---|
| `light` | `composer-2.5` | CSS tweaks, lint fixes, docs, simple tests, small local edits |
| `normal` | `grok-4.7-medium` | Default. Normal feature work, multi-file fixes, ordinary bug investigation |
| `hard` | `grok-4.7-high` | Complex bugs, larger refactors, broad implementation work |

Do not use `fast`, `xhigh`, or other model families by default. Do not change
the model family as a workaround for an environment or tooling failure. Repair
or retry and resume delegation at the appropriate tier when delegation remains
appropriate under the ownership conditions. If Luna's independent
direct-implementation conditions are met, follow that route instead.

## Checkout and worktrees

The standard checkout is `~/web/receipt-manager`; additional worktrees are
stored at `~/worktrees/receipt-manager/<task-name>`. Environment files live
outside Git under `~/.config/receipt-manager/<environment>/`. Follow
[worktree-development.md](./worktree-development.md) for create, list, reuse,
setup, removal, and Cursor delegation commands.

Use a direct checkout only when one worker is running, the checkout is clean,
and there is no concurrent work. Use the standard Git worktree flow when workers
run in parallel, the checkout is dirty, edits are concurrent, or a large or
risky change needs isolation. Existing worktrees in other locations are not
moved or removed automatically.

The delegation monitor locks the canonical path of the workspace passed to
Cursor. Duplicate delegation to the same workspace is rejected, including
requests that use a relative path or symlink; distinct worktrees can run
concurrently. Direct delegation to the standard checkout is protected by its
own workspace lock. Lock and per-workspace status files are stored under the
private `~/.local/state/receipt-manager/delegate-cursor/` directory (or the
configured `XDG_STATE_HOME`).

Do not use `--allow-dirty` as a shortcut. It is only appropriate when mixing
changes is intentional and explicitly approved by the supervisor or user.

## Retry and redesign

- If an implementation attempt is unproductive, clarify the work order and
  retry at the next tier. Do not repeat unproductive retries at the same tier.
  `light` retries as `normal`; `normal` retries as `hard`.
- If a `hard` attempt still fails and redesign is needed, use the Sol
  escalation above before another implementation attempt.
- Review high-risk work in Codex even after a successful worker run.

## Playwright MCP permissions

The project config exposes only the pinned Playwright MCP server through
`.cursor/mcp.json`. `.cursor/cli.json` grants `Mcp(playwright:*)` while keeping
existing Shell permissions and denials intact. Do not add `--approve-mcps` to
the delegation command: that flag approves all configured MCP servers. Cursor
CLI discovers project MCP configuration automatically; when a server approval
is required, approve only `playwright`. Use `agent mcp list` and
`agent mcp list-tools playwright` to diagnose discovery and tool registration.

Use Playwright MCP sequentially within one worktree because its persistent
browser profile is locked to one browser process at a time. The profile is
workspace-keyed, so separate worktrees retain separate sessions. See
[worktree-development.md](./worktree-development.md) for setup, browser cache,
troubleshooting, and pin-update steps.
