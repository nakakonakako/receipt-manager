#!/usr/bin/env python3
"""Run the local db guard in a pseudo-terminal using the mock CLI."""

from __future__ import annotations

import errno
import os
import pty
import select
import signal
import sys
import time


repo, confirmation, expected_code = sys.argv[1], sys.argv[2], int(sys.argv[3])
script = sys.argv[4] if len(sys.argv) > 4 else "db-push.sh"
working_directory = sys.argv[5] if len(sys.argv) > 5 else repo
script_path = os.path.join(repo, "scripts", script)
inputs = confirmation.split("|") if confirmation else []
pid, fd = pty.fork()
if pid == 0:
    os.chdir(working_directory)
    os.execv("/bin/bash", ["/bin/bash", script_path])

output = bytearray()
next_input = 0
status = None
deadline = time.monotonic() + 15
time.sleep(0.4)
while True:
    if time.monotonic() >= deadline:
        os.kill(pid, signal.SIGKILL)
        _, status = os.waitpid(pid, 0)
        sys.stderr.write(output.decode(errors="replace"))
        raise SystemExit("PTY child timed out")
    try:
        readable, _, _ = select.select([fd], [], [], 0.2)
        if readable:
            output.extend(os.read(fd, 4096))
        while next_input < len(inputs):
            value = inputs[next_input]
            os.write(fd, b"\x04" if value == "__EOF__" else (value + "\n").encode())
            next_input += 1
            time.sleep(0.05)
        finished, wait_status = os.waitpid(pid, os.WNOHANG)
        if finished:
            status = wait_status
            break
    except OSError as exc:
        if exc.errno != errno.EIO:
            raise
        break
if status is None:
    _, status = os.waitpid(pid, 0)
exit_code = os.waitstatus_to_exitcode(status)
if exit_code != expected_code:
    sys.stderr.write(output.decode(errors="replace"))
    raise SystemExit(f"Unexpected exit code {exit_code}; expected {expected_code}")
if b"do-not-print-test-secret" in output:
    raise SystemExit("A secret appeared in command output")
