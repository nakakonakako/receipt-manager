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
failure prevents delegation, report the concrete failure. For network, sandbox,
execution-tool, or approval-policy failures, follow the execution-environment
policy below; do not retry the same blocked invocation. Make one bounded repair
only when it directly addresses the observed cause. Luna may take over only
when the independent direct-implementation conditions above are met. Tooling
failure alone does not justify takeover, skipping Sol review or quality checks,
or changing the model family.

Quality checks, security review, tests, final diff review, and Git/worktree
safety apply regardless of who implements.

## Execution tools, network access, and approval policy

Cursor CLI must connect to its external API. Before invoking
`scripts/delegate-cursor.sh`, the Supervisor checks the execution tools exposed
in the current session, their documented argument schemas, and the active
sandbox, network, and approval policy. Select the execution method from that
current evidence. Do not infer tool names or arguments from another session.

| Observed condition | Supervisor action |
|---|---|
| Network access is already allowed | Invoke the delegation script through the currently available execution tool. Do not request unnecessary privilege escalation. |
| Network is restricted and an official limited approval path is available | Request approval through that path for the delegation command only. Keep the approval scoped; do not change project-wide sandbox or approval settings. |
| Limited approval is unavailable or denied | Stop before invoking or retrying the command. Report the specific restriction and request an approved network-enabled Codex environment or operator-run delegation in such an environment. |
| No exposed execution tool can launch the script | Stop and report the missing execution capability; continue only in an environment with a supported command execution tool. |
| An argument such as `require_escalated` is absent or unsupported | Do not pass, emulate, or assume that argument. Use another currently supported limited approval path if available; otherwise stop and report the constraint. |
| The execution tool API name differs from a previous session | Use the currently exposed equivalent only when its documented capability and current policy permit the command; otherwise stop and report the limitation. |

Never automatically enable `danger-full-access` to run Cursor. If a broad
permission mode is already active, it is not evidence that the operation has
least privilege. Do not widen or alter that mode; keep the work order and
invocation bounded, and note the broader environment as an operational caveat.

Classify failures from observed evidence, without conflating them:

- DNS, connection, or egress-denial errors are network failures.
- Missing or expired credentials are authentication failures.
- An explicit missing Playwright MCP approval is an MCP approval issue. Follow
  the manual, Playwright-only procedure in [Playwright MCP permissions](#playwright-mcp-permissions).
- No available shell/command execution capability is an execution-tool failure.
- A missing, denied, or unsupported limited-approval mechanism is an
  approval-policy failure.
- Model/service errors remain separate; do not infer implementation difficulty
  from a generic or environment error.

Repair only when a bounded action addresses the observed cause. If the policy
blocks execution or approval is refused, stop and report the available
alternative environment. Do not change model tiers or routes for environment
failures, and do not retry indefinitely. Keep the existing implementation-tier,
Other Models, trust, worktree, monitor, and MCP approval rules below intact.

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

Use the fixed tier mapping through the delegation script, with `light` by
default:

| Tier | Model | Typical work |
|---|---|---|
| `light` | `composer-2.5` | CSS tweaks, lint fixes, docs, simple tests, small local edits |
| `normal` | `grok-4.7-medium` | Retry after Composer implementation difficulty and a clarified work order |
| `hard` | `grok-4.7-high` | Retry after medium implementation difficulty; redesign after a hard failure goes to Sol |

Do not use `fast`, `xhigh`, or other model families by default. For an
environment or tooling failure, follow [Execution tools, network access, and
approval policy](#execution-tools-network-access-and-approval-policy); do not
change the model family or retry the same blocked command. If a cause-matched
repair makes delegation possible, resume at the already selected tier. If
Luna's independent direct-implementation conditions are met, follow that route
instead.

## Checkout and worktrees

The standard checkout is `~/web/receipt-manager`; additional worktrees are
stored at `~/worktrees/receipt-manager/<task-name>`. Environment files live
outside Git under `~/.config/receipt-manager/<environment>/`. Follow
[worktree-development.md](./worktree-development.md) for create, list, reuse,
setup, removal, and Cursor delegation commands.

For new Codex sessions, use the installed `receipt-manager-codex` launcher
described in [worktree-development.md](./worktree-development.md#starting-codex).
It fetches `origin/main` before Codex reads repository instructions and starts
in a new verified worktree. The delegation launcher guard below remains
separate: it validates the checkout used to launch Cursor, and does not protect
Codex sessions that were started through another entry point.

Use a direct checkout only when one worker is running, the checkout is clean,
and there is no concurrent work. Use the standard Git worktree flow when workers
run in parallel, the checkout is dirty, edits are concurrent, or a large or
risky change needs isolation. Existing worktrees in other locations are not
moved or removed automatically.

## Launcher checkout freshness and provenance

When invoking `scripts/delegate-cursor.sh` directly, the Supervisor explicitly
fetches the baseline:

```sh
git fetch origin main
```

Then check the checkout from which `scripts/delegate-cursor.sh` will actually
run. The launcher resolves its own physical path and Git root, rather than
assuming the caller's current directory identifies the source checkout. It
reads the local `refs/remotes/origin/main` commit without fetching or changing
any ref. The reported baseline SHA is therefore the locally available
remote-tracking value; only the Supervisor's preceding successful fetch
establishes that it was refreshed for this run.

For a launcher source checkout on branch `main`, the launcher permits an exact
match with `origin/main`, and also a local main that is ahead while containing
the fetched baseline. It stops before worktree creation/reuse, setup, or Cursor
startup when main is behind, diverged, unrelated, or the ancestry relation
cannot be verified. The error includes the source and baseline SHAs and directs
the Supervisor to fetch and start from an appropriate checkout. It never runs
fetch, pull, reset, or checkout itself. A missing or invalid `origin/main`, an
unreadable HEAD, or an unresolvable launcher Git root also stops delegation;
unknown state is never treated as fresh.

Feature branches and detached HEAD checkouts are allowed when their HEAD is
valid, even when it differs from `origin/main` or points to a historical
commit. The launcher reports `(detached HEAD)` instead of inferring a branch.
The baseline ref must still exist so the invocation has a comparable, explicit
reference in its provenance record.

The launcher prints its absolute source path, source checkout, branch and HEAD,
the baseline ref and SHA, the absolute Worker workspace and its branch and
HEAD, and the monitor script path and `--checkout` workspace. The monitor and
worktree manager are always loaded from the launcher's source checkout; a
modified copy inside the Worker workspace is not executed. These records
contain paths and Git identifiers only, not environment values or credentials.

If the ordinary checkout is behind, launch Cursor from a current dedicated
worktree. This delegation guard is implemented by the script version being
run; it is independent of the Codex session launcher and only runs when
delegation starts.

The delegation monitor locks the canonical path of the workspace passed to
Cursor. Duplicate delegation to the same workspace is rejected, including
requests that use a relative path or symlink; distinct worktrees can run
concurrently. Direct delegation to the standard checkout is protected by its
own workspace lock. Lock and per-workspace status files are stored under the
private `~/.local/state/receipt-manager/delegate-cursor/` directory (or the
configured absolute `XDG_STATE_HOME`). The monitor opens every path component
without following symlinks and rejects unsafe ownership or write permissions;
the final state directory must be owned by the current user with mode `0700`.
Unsafe existing paths stop delegation and are never chmodded, replaced, or
removed automatically. Workspace locks, status updates, and diagnostic files
use the validated directory descriptor. Status replacement uses a unique,
exclusive temporary file, and diagnostic retention only removes validated
private regular files. State storage failures before launch prevent Cursor
from starting; a status write failure after launch is reported while worker
monitoring and signal cleanup continue.

## Monitor stream, progress, and status bounds

The shared, versioned behavioral acceptance criteria and their test mapping are
documented in [cursor-monitor-contract.md](./cursor-monitor-contract.md).
That initial contract does not imply adoption by another repository.

Each stdout stream-json record is limited to 256 KiB by byte count. An
oversized record is discarded through its next newline and counted once; parsing
resumes with the next record. An unterminated final record within the limit is
parsed, including CRLF-delimited records. Malformed JSON and unknown event
contents are never printed. The final worker report retains its separate 64 KiB
input and 4 KiB output limits.

Ordinary progress output is capped at 300 lines across event and tool notices,
assistant update summaries, heartbeat messages, and stderr category notices.
Excess lines are counted and reported in the final summary. Startup and safety
failures, signal/interruption notices, status storage errors, final state and
exit code, and the verification report are not suppressed.

Status JSON keeps its existing filename and fields. It is saved before worker
startup, after startup, when a signal arrives, at each heartbeat, and when the
worker exits. Events and stderr chunks update the in-memory snapshot and do not
trigger individual status writes. The default heartbeat interval is 30 seconds;
it indicates that the monitor is alive and does not guarantee worker progress.

Raw stderr is never saved or displayed. On failure or interruption, a
best-effort diagnostic excerpt may be saved after secret redaction, limited to
12 lines and 8 KiB. At most 20 diagnostic files are retained for 7 days. The
redaction is best-effort, so these bounded excerpts remain sensitive diagnostic
data. If diagnostic persistence fails, worker result classification and
cleanup are unchanged.

Do not use `--allow-dirty` as a shortcut. It is only appropriate when mixing
changes is intentional and explicitly approved by the supervisor or user.

## Retry and redesign

- If an implementation attempt is unproductive, clarify the work order and
  retry at the next tier. Do not repeat unproductive retries at the same tier.
  `light` retries as `normal`; `normal` retries as `hard`.
- For network, sandbox, execution-tool, authentication, MCP, or approval-policy
  failures, use the execution-environment policy above. Do not escalate tiers or
  retry a blocked command because of these failures.
- If a `hard` attempt still fails and redesign is needed, use the Sol
  escalation above before another implementation attempt.
- Review high-risk work in Codex even after a successful worker run.

## Cursor Models quota and explicit Other Models routes

The monitor automatically categorizes bounded stderr signals such as
`resource_exhausted`, network, authentication, permissions, and MCP
initialization. These categories help diagnosis; they do not decide the final
cause or change the model route. The current CLI result/status output does not
provide a verified quota-specific signal or remaining-pool balance. In
particular, one `resource_exhausted` or capacity error does not establish
usage/quota exhaustion.

Only the Supervisor chooses an Other Models route, after reviewing separate,
credible usage/quota evidence or a recurring service/model-side failure. For
the latter, make one independent, bounded confirmation run on the normal Cursor
Models route and require the same failure to recur before considering a route
change. Do not retry indefinitely. Repair network, MCP, authentication,
worktree, dev-server, browser, or other environment failures without changing
models. Keep implementation-difficulty retries and Sol redesign escalation
separate from this route decision.

Supported explicit routes are:

| Option | Route / tier | Model |
|---|---|---|
| `--fallback-tier light` | `other-models` / `fallback-light` | `gemini-3.8-flash-low` |
| `--fallback-tier normal` | `other-models` / `fallback-normal` | `claude-sonnet-5-5-medium` |
| `--model-override gpt-5.6-luna-medium` | `other-models-reserve` / `model-override` | `gpt-5.6-luna-medium` |

They cannot be combined with `--tier` or each other. The script never
auto-selects a fallback, automatically retries another route, or changes
billing settings. Other Models availability and billing depend on the current
Cursor plan, account, and team settings; selecting a route can have different
cost treatment from Cursor Models. The user must review their own plan and
billing settings before a Supervisor selects one. Current public model docs
confirm the corresponding model families and `agent models` is the CLI catalog
command, but this implementation did not read local credentials or query the
account-specific catalog. Exact variant availability therefore remains
account-dependent and unverified here.

The monitor prints and records the selected `route`, `tier`, and `model` in its
per-workspace status. These fields identify the requested CLI selection; they
do not independently attest which backend model ultimately served the turn.

## Playwright MCP permissions

The project exposes two pinned MCP servers in `.cursor/mcp.json`:
`playwright` for headed authenticated checks using the one shared profile, and
`playwright-unauth` for isolated pre-login checks. `.cursor/cli.json` grants
only the named Playwright MCP capabilities while preserving existing Shell
permissions and denials. Never add `--approve-mcps`; when approval is required,
approve only the MCP selected for that task. Use `agent mcp list` and
`agent mcp list-tools <server-name>` to diagnose discovery.

The official verification sequence is `npm run devserver:ensure` → selected
Playwright MCP → `http://localhost:5274/` on desktop and mobile viewports →
worker evidence report → `npm run devserver:stop`. The verification pair is
Vite `5274` → FastAPI `8100`; ordinary human development remains `5174` →
`8000`. Server reuse and stop are limited to proven sessions owned by that
canonical worktree. The authenticated profile at
`~/.local/state/receipt-manager/playwright-profile` is shared across worktrees
and can be open in only one browser at a time. Never inspect, copy, clear, or
log it, and never automate OAuth. See
[worktree-development.md](./worktree-development.md) for browser setup, manual
first login, Supabase redirect allowlisting, server safety, and pin updates.

## Completion report

The worker must include one `VERIFICATION RESULTS` block near the start of its
final report. Declare `COVERAGE: COMPLETE` or `COVERAGE: INCOMPLETE`, then give
each acceptance criterion exactly one `PASS`, `FAIL`, or `UNCONFIRMED` line in
the form `STATUS: criterion — observed evidence`. A tool call by itself does
not establish a passing result. The monitor displays explicit findings before
the legacy intent, changed files, verification, risks, and supervisor-decision
sections; those section headings remain supported for older reports.
The monitor shows detected counts for each status, reserves the first finding
from every present status before the remaining FAIL, UNCONFIRMED, and PASS
findings, and reports per-status omissions when the 4 KiB display cap is reached.

The monitor keeps the report in memory only, sanitizes known and environment
secrets, caps captured input at 64 KiB, and caps displayed output at 4 KiB.
Missing, malformed, repeated, conflicting, or input-truncated verification is
shown as `UNCONFIRMED`. These report findings do not change the Cursor CLI
process/result exit classification.
