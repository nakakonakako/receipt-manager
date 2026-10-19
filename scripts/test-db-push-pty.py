#!/usr/bin/env python3
"""Run the local db:push guard in a pseudo-terminal using the mock CLI."""

from __future__ import annotations

import errno
import os
import pty
import select
import sys


repo, confirmation, expected_code = sys.argv[1], sys.argv[2], int(sys.argv[3])
script = sys.argv[4] if len(sys.argv) > 4 else "db-push.sh"
working_directory = sys.argv[5] if len(sys.argv) > 5 else repo
script_path = os.path.join(repo, "scripts", script)
pid, fd = pty.fork()
if pid == 0:
    os.chdir(working_directory)
    os.execv("/bin/bash", ["/bin/bash", script_path])

os.write(fd, (confirmation + "\n").encode())
output = bytearray()
while True:
    try:
        readable, _, _ = select.select([fd], [], [], 0.2)
        if readable:
            output.extend(os.read(fd, 4096))
        finished, _ = os.waitpid(pid, os.WNOHANG)
        if finished:
            break
    except OSError as exc:
        if exc.errno != errno.EIO:
            raise
        break
_, status = os.waitpid(pid, 0)
exit_code = os.waitstatus_to_exitcode(status)
if exit_code != expected_code:
    sys.stderr.write(output.decode(errors="replace"))
    raise SystemExit(f"Unexpected exit code {exit_code}; expected {expected_code}")
if b"do-not-print-test-secret" in output:
    raise SystemExit("A secret appeared in command output")
