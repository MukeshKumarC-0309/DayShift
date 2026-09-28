"""The Windows scripts, checked on any platform.

Windows PowerShell 5.1 reads a script without a byte-order mark as
Windows-1252. A UTF-8 em dash ends in byte 0x94, which it takes for a curly
closing quote: inside a double-quoted string that ends the string early and
the script no longer parses. Keeping the Windows scripts ASCII-only avoids
the whole class of problem.
"""

from __future__ import annotations

from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
WINDOWS_SCRIPTS = sorted(
    [
        *ROOT.glob("*.cmd"),
        *ROOT.glob("bin/*.cmd"),
        *ROOT.glob("bin/*.ps1"),
        *ROOT.glob("scripts/*.ps1"),
    ]
)


def test_there_are_windows_scripts() -> None:
    names = {p.name for p in WINDOWS_SCRIPTS}
    assert {"start.cmd", "start.ps1", "dayshift.cmd", "dayshift.ps1"} <= names


@pytest.mark.parametrize("script", WINDOWS_SCRIPTS, ids=lambda p: p.name)
def test_windows_script_is_ascii(script: Path) -> None:
    for number, line in enumerate(script.read_bytes().splitlines(), start=1):
        bad = [b for b in line if b > 0x7F]
        assert not bad, f"{script.name}:{number} has non-ASCII bytes: {line!r}"
