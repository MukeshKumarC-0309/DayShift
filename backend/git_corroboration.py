"""Corroborating logged time with local git commits.

Read-only and informational. Dayshift runs `git log` against repositories you
point it at, counts YOUR commits per day, and shows them beside the minutes you
logged. It never changes a log, and a flag is a prompt to look, not a verdict:
plenty of real work (reading, debugging, design) produces no commit.

Everything here is local: `git` reads the repository on disk. No network.
"""

from __future__ import annotations

import re
import shutil
import subprocess
from collections import Counter
from dataclasses import dataclass
from datetime import date
from pathlib import Path

GIT_TIMEOUT_SECONDS = 10

# A day with at least this many logged minutes and no commits is flagged.
LOGGED_WITHOUT_COMMITS_MIN = 60


class GitError(Exception):
    """A repository could not be read."""


def _git(path: Path, *args: str) -> str:
    git = shutil.which("git")
    if git is None:
        raise GitError("git is not installed on this machine")
    try:
        result = subprocess.run(  # fixed binary, list args, no shell
            [git, "-C", str(path), *args],
            capture_output=True,
            text=True,
            timeout=GIT_TIMEOUT_SECONDS,
            check=False,
        )
    except subprocess.TimeoutExpired as exc:
        raise GitError("git took too long to answer") from exc
    if result.returncode != 0:
        raise GitError(result.stderr.strip() or f"git {args[0]} failed")
    return result.stdout


def normalise_path(raw: str) -> Path:
    """Expand `~` and make absolute. Does not check that it exists."""
    return Path(raw.strip()).expanduser().resolve()


def validate_repo(path: Path) -> None:
    """Raise GitError unless `path` is a readable git work tree."""
    if not path.is_dir():
        raise GitError(f"{path} is not a folder on this machine")
    if _git(path, "rev-parse", "--is-inside-work-tree").strip() != "true":
        raise GitError(f"{path} is not a git repository")


def commits_by_day(path: Path, start: date, end: date) -> dict[str, int]:
    """Your commits per local date in [start, end], across all branches.

    "Your" means authored with the repository's configured `user.email`; with
    none configured, every commit counts.
    """
    try:
        email = _git(path, "config", "user.email").strip()
    except GitError:
        email = ""
    args = [
        "log",
        "--all",
        "--no-merges",
        f"--since={start.isoformat()} 00:00:00",
        f"--until={end.isoformat()} 23:59:59",
        "--date=format-local:%Y-%m-%d",
        "--format=%ad",
    ]
    if email:
        args.append(f"--author={email}")
    out = _git(path, *args)
    counts = Counter(line.strip() for line in out.splitlines() if line.strip())
    return {
        day: n for day, n in counts.items() if start.isoformat() <= day <= end.isoformat()
    }


ISSUE_REF = re.compile(r"^#?(\d+)$")


def _your_email(path: Path) -> str:
    try:
        return _git(path, "config", "user.email").strip()
    except GitError:
        return ""


def ref_commits(path: Path, ref: str, day: date) -> int | None:
    """Your commits on `day` that belong to a session's branch or issue.

    An issue reference (`#42` or `42`) counts commits that day whose message
    mentions `#42` (not `#420`). Anything else is taken as a branch name and
    counts that day's commits on that branch; None if the repository has no
    such branch. A reference starting with "-" is refused outright, so it can
    never be read as a git option.
    """
    ref = ref.strip()
    if not ref or ref.startswith("-"):
        return None
    window = [
        "--no-merges",
        f"--since={day.isoformat()} 00:00:00",
        f"--until={day.isoformat()} 23:59:59",
        "--format=%H",
    ]
    email = _your_email(path)
    if email:
        window.append(f"--author={email}")

    issue = ISSUE_REF.match(ref)
    if issue:
        number = issue.group(1)
        out = _git(path, "log", "--all", "-E", f"--grep=#{number}([^0-9]|$)", *window)
    else:
        try:
            _git(path, "rev-parse", "--verify", "--quiet", f"refs/heads/{ref}")
        except GitError:
            return None
        out = _git(path, "log", f"refs/heads/{ref}", *window)
    return len([line for line in out.splitlines() if line.strip()])


@dataclass(frozen=True)
class DayComparison:
    """One day: what was logged against what was committed."""

    day: str
    minutes: int
    commits: int

    @property
    def flag(self) -> str | None:
        """`logged_no_commits`, `commits_not_logged`, or None."""
        if self.minutes >= LOGGED_WITHOUT_COMMITS_MIN and self.commits == 0:
            return "logged_no_commits"
        if self.commits > 0 and self.minutes == 0:
            return "commits_not_logged"
        return None
