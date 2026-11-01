# Worktree removal safety contract

## Purpose and scope

This document defines the shared v1 safety contract for
`scripts/worktree.sh remove` in receipt-manager and price-memo. It covers the
observable protections around deleting a Git worktree. It does not define or
standardize the internal process-inspection implementation.

The contract is independent of the Cursor delegation monitor contracts
MON-01–08. It does not require a shared package, cross-repository CI, Cursor
session tracking, or process termination.

The acceptance conditions below describe behavior that can be stated from the
current receipt-manager implementation. Where test coverage is narrower than
the implementation, the gap is called out separately; a test mapping is not a
claim that every edge case is exercised.

## Version and adoption status

This is contract version **v1**. This PR introduces v1 for receipt-manager;
adoption takes effect when this PR is merged. price-memo is a read-only
comparison in this change. Its formal v1 adoption and complete test mapping are
**pending a separate price-memo PR**. Do not treat both repositories as fully
adopted until that PR is reviewed, merged, and its CI result is recorded.

The comparison used these `origin/main` commits:

| Repository | Compared `origin/main` |
| --- | --- |
| receipt-manager | `a049f1e41e0a3f73f7e3885deddb106a07243a6b` |
| price-memo | `3b71cd06f34f37b8de39b0bd592082e9f6aebdd6` |

Related merged implementation PRs were checked as follows:

| Repository / PR | Merged commit | `pr-quality` |
| --- | --- | --- |
| receipt-manager #55 | `8fd94d616e35c6511e7c364e4618a89229ecd6f6` | success |
| receipt-manager #56 | `cd1d425917685c86039d8a4efb6cc8081bfc8c1a` | success |
| price-memo #57 | `3b71cd06f34f37b8de39b0bd592082e9f6aebdd6` | success |

The adoption record for each repository must include the contract version, the
merged PR/commit, and its CI result. Keep the price-memo status pending until
its independent PR supplies that record.

## Contract v1: WT-01–WT-08

### WT-01 — Limit the deletion target

The remove command canonicalizes the requested directory, requires it to be
inside the repository's standard worktree area, and checks that its Git common
directory matches the invoking repository. Git's non-forced
`git worktree remove` is the final Git-level validation and deletion step.
Symlink aliases must resolve to the physical worktree path, and similar path
prefixes must not be treated as descendants.

The wrapper does not independently prove registration by comparing the target
against `git worktree list` or checking `--show-toplevel` equals the requested
path. Do not describe that preflight as an explicit registration proof. A
successful removal must still be accepted by Git as a removable worktree.

Receipt-manager evidence: `canonical_worktree()` in
`scripts/worktree.sh`; `test_clean_stopped_worktree_can_be_removed` and
`test_symlink_alias_resolves_to_registered_worktree` in
`scripts/test-worktree-remove-guard.py`. The symlink test verifies the physical
worktree is removed, the alias itself remains as a dangling symlink, Git no
longer lists the worktree, and its branch remains. There is no dedicated
negative test for a different repository or a path outside the standard area.

### WT-02 — Protect uncommitted work

Refuse removal when `git status --porcelain` reports staged, unstaged, or
untracked changes. Use non-forced `git worktree remove`; do not delete the
branch. The contract does not claim that ignored files are enumerated by the
status precheck.

Receipt-manager evidence: `test_dirty_worktree_is_refused`,
`test_clean_stopped_worktree_can_be_removed`, and
`test_symlink_alias_resolves_to_registered_worktree`, plus the clean/dirty
remove checks in `scripts/test-worktree.sh`. The dirty regression test creates
an untracked file; staged and unstaged variants are not separately covered.

### WT-03 — Require explicit confirmation and inspect twice

Require the literal confirmation input `remove`. Run process inspection before
the prompt and again after confirmation immediately before deletion. If the
inspector reports a blocked process or an inspection error, stop without
calling Git removal.

Receipt-manager evidence: `test_process_started_while_waiting_for_confirmation_blocks_second_scan`,
`test_proc_enumeration_failure_refuses`, and
`test_inspector_failure_exit_refuses_removal`; successful removal tests provide
the positive confirmation path. A wrong or cancelled confirmation value is
not covered by a dedicated regression test.

### WT-04 — Detect live processes by cwd

Refuse removal when an inspectable, live process has a canonical cwd equal to
the target worktree or a directory below it. Ignore zombies. Do not match a
different worktree or a sibling whose name merely shares a path prefix.

Receipt-manager evidence: `test_live_process_in_subdirectory_blocks_then_retry_succeeds`,
`test_other_worktree_process_is_not_affected`,
`test_similar_path_prefix_is_not_matched`,
`test_zombie_is_not_reported_as_running`, and
`test_symlink_alias_resolves_to_registered_worktree`.

### WT-05 — Confirm PID identity around cwd inspection

Do not attribute cwd to a process based on PID alone. For direct cwd detection,
sample `/proc/<pid>/stat`, read cwd, then sample stat again. Accept the cwd
observation only when the start time matches and both samples are non-zombie.
A change between other live states, such as sleeping and running, is not by
itself PID reuse. If the process exited, became a zombie, or the PID was reused,
discard the old cwd observation.

Receipt-manager evidence: `_same_process()` in
`scripts/worktree-remove-inspect.py` and
`test_pid_reuse_during_scan_is_ignored`, `test_process_exit_during_scan_is_ignored`,
`test_zombie_is_not_reported_as_running`, and
`test_live_state_transition_does_not_look_like_pid_reuse`. The latter test was
added with this contract because the earlier suite did not separately exercise
a non-zombie state transition with a stable start time.

### WT-06 — Handle inspection failures according to association evidence

Failure to enumerate `/proc` prevents safe inspection and refuses removal.
When evidence links a process to the target, failure to confirm the process
identity must not turn that evidence into permission to remove. Do not infer
that every unreadable PID belongs to the target; repository-specific stricter
checks are allowed and must be documented.

Receipt-manager currently behaves as follows:

- A same-user PID whose initial stat cannot be read fails closed.
- If cwd is readable and lies in the target but the post-cwd stat cannot be
  read, inspection fails and removal is refused.
- If cwd cannot be read, the inspector rechecks PID/start-time identity. A
  failed stat recheck refuses removal. If the same live process is confirmed,
  its worktree relationship remains unknown and that PID is skipped.
- `/proc` enumeration failure refuses removal.

Receipt-manager evidence: `test_proc_enumeration_failure_refuses`,
`test_unreadable_same_user_stat_fails_closed`,
`test_unreadable_cwd_rechecks_pid_identity_but_does_not_infer_membership`, and
`test_unreadable_cwd_and_failed_identity_recheck_refuse`. The tests use mocked
`/proc` access in the isolated Git fixture. Foreign-user and unknown-owner stat
failure branches are not individually covered.

The current price-memo behavior is different and is not yet a formal v1
adoption: an unassociated PID's initial stat failure is skipped; after cwd has
been observed inside the target, a failed stat recheck refuses; a failed
recheck with external or unreadable cwd and no recorded Cursor association is
skipped. price-memo's recorded Cursor PID/group candidates have their own
fail-closed checks. These differences must remain visible in its adoption PR;
do not summarize WT-06 as identical handling or as universal fail-closed
inspection.

### WT-07 — Do not interfere with processes or expose their data

The guard never signals or kills a process and does not alter processes in
other worktrees. It must not print or persist environment-variable values or
full command lines. Printing a bounded PID list and generic inspection reasons
is permitted.

Receipt-manager evidence: `test_live_process_in_subdirectory_blocks_then_retry_succeeds`
asserts the target process remains alive after refusal, and
`test_other_worktree_process_is_not_affected` asserts the other worktree's
process remains alive. Receipt-manager does not read `/proc/<pid>/environ` or
command lines. The suite has no dedicated assertion that output excludes
synthetic secret values.

### WT-08 — State the detection limits

The guard is a Linux `/proc` cwd check, not a complete process-tree ownership
system. It cannot generally detect an unrecorded process after cwd moves outside
the worktree. A PID whose inspection data is unreadable and whose relationship
to the target cannot be established may be skipped, so a related process can
be missed. A race remains between the final process inspection and Git removing
the worktree. The contract does not promise support on every OS, complete
process-tree detection, or automatic recovery after forced termination. The
guard never kills processes.

Receipt-manager evidence: limitations in `docs/worktree-development.md`; the
suite verifies the second inspection catches a process started while the
confirmation prompt is open, but it cannot eliminate or fully test the final
inspection-to-removal race.

## price-memo optional extension (not required by v1)

price-memo's Cursor Playwright devserver has additional evidence that
receipt-manager does not issue: a worktree-specific recorded PID/PGID/SID/start
time, a nonce marker, and recorded launch PIDs. Its guard can detect matching
orphan group members after a leader exits or a member moves cwd outside the
worktree, and refuses removal when a recorded or matching process cannot be
inspected safely. It reads `/proc/<pid>/environ` in memory to compare the
dedicated marker with the recorded nonce; it does not print environment values.

These are price-memo-specific extension guarantees, not WT-01–WT-08
preconditions. receipt-manager has no equivalent session issuer. At the
price-memo baseline commit above, related tests include
`test_stale_cursor_session_does_not_block`,
`test_reused_session_pid_does_not_trust_stale_group`,
`test_orphaned_cursor_group_child_with_moved_cwd`,
`test_recorded_cursor_group_stat_recheck_failure_refuses`, and
`test_associated_process_inspection_failure_refuses`. These names are evidence
from the comparison snapshot only; their binding to v1 must be made in the
separate price-memo adoption PR.

## Allowed implementation differences

The repositories may keep different process-inspection and failure-handling
code. Both must meet the shared observable conditions above, while each
implementation's stricter behavior and known skip cases remain explicit.
price-memo's session/group/nonce extension may remain additional protection.
Do not remove that protection to make the code look more alike, and do not
claim receipt-manager provides it.

## Updating the contract

1. Treat WT-01–WT-08 meanings as versioned acceptance conditions. A semantic
   change requires a new contract version; do not silently redefine v1 in one
   repository.
2. Review implementation and test evidence in both repositories before
   proposing the change. Keep app-specific behavior in each repository's own
   tests and docs.
3. Create independently reviewable PRs in each repository. Do not use one
   worker or one PR to modify both repositories.
4. In each adoption/update PR, record the contract version, compared base SHA,
   PR URL, merged commit, CI result, and any untested conditions. Update the
   adoption table only after the corresponding PR is merged and CI is green.
5. Do not add an external-repository CI dependency or shared library solely to
   enforce this documentation contract. No price-memo adoption is implied by
   receipt-manager's v1 document or tests.

This document is the worktree-removal contract. The Cursor delegation monitor
contracts MON-01–08 are separate and do not change these requirements.
