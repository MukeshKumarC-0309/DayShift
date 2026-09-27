"""Git corroboration: your commits beside the minutes you logged.

Read-only and informational (see git_corroboration.py). A flag never changes
a log; the frontend lets you dismiss any flag. Works only where the backend
can see the repositories — i.e. when Dayshift runs on your own machine, not
on a hosted server.
"""

from __future__ import annotations

from datetime import date, timedelta
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.orm import Session

import git_corroboration as gc
import repository
import sessions_service as svc
from auth import require_auth
from database import get_db
from models import Category, GitRepo
from schemas import GitCategoryOut, GitDay, GitRepoCreate, GitRepoOut, RefCommits

router = APIRouter(
    prefix="/api/corroboration",
    tags=["corroboration"],
    dependencies=[Depends(require_auth)],
)


def _names(db: Session) -> dict[int, str]:
    return {c.id: c.name for c in repository.active_categories(db, include_archived=True)}


@router.get("/repos", response_model=list[GitRepoOut])
def list_repos(db: Session = Depends(get_db)) -> list[GitRepoOut]:
    """List the configured repositories."""
    names = _names(db)
    return [
        GitRepoOut(
            id=r.id,
            path=r.path,
            category_id=r.category_id,
            category_name=names.get(r.category_id, f"#{r.category_id}"),
        )
        for r in db.scalars(select(GitRepo).order_by(GitRepo.id))
    ]


@router.post("/repos", response_model=GitRepoOut, status_code=status.HTTP_201_CREATED)
def add_repo(payload: GitRepoCreate, db: Session = Depends(get_db)) -> GitRepoOut:
    """Add a repository after checking it is a readable git work tree."""
    category = db.get(Category, payload.category_id)
    if category is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No category")
    path = gc.normalise_path(payload.path)
    try:
        gc.validate_repo(path)
    except gc.GitError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(exc)
        ) from exc
    if db.scalar(select(GitRepo).where(GitRepo.path == str(path))) is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="That repository is already added",
        )
    repo = GitRepo(path=str(path), category_id=category.id)
    db.add(repo)
    db.commit()
    db.refresh(repo)
    return GitRepoOut(
        id=repo.id, path=repo.path, category_id=category.id, category_name=category.name
    )


@router.delete("/repos/{repo_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_repo(repo_id: int, db: Session = Depends(get_db)) -> None:
    """Stop reading a repository. Nothing in it is touched."""
    repo = db.get(GitRepo, repo_id)
    if repo is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No repository")
    db.delete(repo)
    db.commit()


@router.get("", response_model=list[GitCategoryOut])
def compare(
    days: int = Query(default=30, ge=7, le=365),
    today: date | None = Query(default=None),
    db: Session = Depends(get_db),
) -> list[GitCategoryOut]:
    """Per category with repositories: each day's minutes against commits.

    Covers the window ending yesterday — today is still in progress.
    """
    reference = today or date.today()
    end = reference - timedelta(days=1)
    start = end - timedelta(days=days - 1)
    names = _names(db)

    by_category: dict[int, list[GitRepo]] = {}
    for repo in db.scalars(select(GitRepo).order_by(GitRepo.id)):
        by_category.setdefault(repo.category_id, []).append(repo)

    out: list[GitCategoryOut] = []
    for category_id, repos in by_category.items():
        commits: dict[str, int] = {}
        errors: list[str] = []
        for repo in repos:
            try:
                for day, n in gc.commits_by_day(Path(repo.path), start, end).items():
                    commits[day] = commits.get(day, 0) + n
            except gc.GitError as exc:
                errors.append(f"{repo.path}: {exc}")
        records = repository.day_records(db, category_id, start, end)
        rows = []
        for day in (start + timedelta(days=i) for i in range(days)):
            key = day.isoformat()
            record = records.get(key)
            comparison = gc.DayComparison(
                day=key,
                minutes=record.real_minutes if record else 0,
                commits=commits.get(key, 0),
            )
            rows.append(
                GitDay(
                    day=key,
                    minutes=comparison.minutes,
                    commits=comparison.commits,
                    flag=comparison.flag,
                )
            )
        out.append(
            GitCategoryOut(
                category_id=category_id,
                category_name=names.get(category_id, f"#{category_id}"),
                repos=[r.path for r in repos],
                errors=errors,
                days=rows,
                total_commits=sum(commits.values()),
                flagged_days=sum(1 for r in rows if r.flag),
            )
        )
    return out


@router.get("/day/{day}", response_model=list[RefCommits])
def ref_commits_for_day(day: date, db: Session = Depends(get_db)) -> list[RefCommits]:
    """For each session that day with a branch/issue: its commits that day.

    Only sessions in categories with linked repositories are included. A
    merged session's joined references ("a, #4") are counted together.
    Read-only, local `git log` — no network.
    """
    by_category: dict[int, list[GitRepo]] = {}
    for repo in db.scalars(select(GitRepo).order_by(GitRepo.id)):
        by_category.setdefault(repo.category_id, []).append(repo)
    out: list[RefCommits] = []
    for session in svc.sessions_for_day(db, day):
        repos = by_category.get(session.category_id)
        if not session.git_ref or not repos:
            continue
        found: list[int] = []
        for ref in (part.strip() for part in session.git_ref.split(",")):
            for repo in repos:
                try:
                    n = gc.ref_commits(Path(repo.path), ref, day)
                except gc.GitError:
                    n = None
                if n is not None:
                    found.append(n)
        out.append(
            RefCommits(
                session_id=session.id,
                git_ref=session.git_ref,
                commits=sum(found) if found else None,
            )
        )
    return out
