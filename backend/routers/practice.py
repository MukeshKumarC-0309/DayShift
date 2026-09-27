"""Practice: the DSA problem log and its revision schedule.

Logging a problem counts one question for its category on the day it was
solved (the same count the dashboard's `+1 Q` button adds to). Editing the
date or deleting the problem moves or removes that count. Revisions never
count as questions — see the DECISION in practice.py.
"""

from __future__ import annotations

import logging
from collections import defaultdict
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

import practice
import repository
from auth import require_auth
from database import get_db
from models import Category, Problem, ProblemReview
from schemas import (
    PracticeSummary,
    ProblemCreate,
    ProblemOut,
    ProblemUpdate,
    ReviewCreate,
    ReviewOut,
    TopicStatOut,
)

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/api/practice", tags=["practice"], dependencies=[Depends(require_auth)]
)


def _schedule(problem: Problem) -> practice.Schedule:
    return practice.schedule_for(
        date.fromisoformat(problem.solved_on),
        [
            practice.Revision(date.fromisoformat(r.reviewed_on), r.outcome)
            for r in problem.reviews
        ],
    )


def _out(problem: Problem, today: date) -> ProblemOut:
    schedule = _schedule(problem)
    return ProblemOut(
        id=problem.id,
        category_id=problem.category_id,
        title=problem.title,
        url=problem.url,
        topic=problem.topic,
        difficulty=problem.difficulty,
        needed_hint=problem.needed_hint,
        solved_on=problem.solved_on,
        notes=problem.notes,
        reviews=[
            ReviewOut(id=r.id, reviewed_on=r.reviewed_on, outcome=r.outcome)
            for r in problem.reviews
        ],
        stage=schedule.stage,
        due_on=schedule.due_on.isoformat() if schedule.due_on else None,
        mastered=schedule.mastered,
        overdue_days=schedule.overdue_days(today),
    )


def _all_problems(db: Session) -> list[Problem]:
    return list(
        db.scalars(
            select(Problem)
            .options(selectinload(Problem.reviews))
            .order_by(Problem.solved_on.desc(), Problem.id.desc())
        ).all()
    )


def _get(db: Session, problem_id: int) -> Problem:
    problem = db.get(Problem, problem_id)
    if problem is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=f"No problem {problem_id}"
        )
    return problem


def _clean(text: str | None) -> str | None:
    if text is None:
        return None
    return text.strip() or None


@router.get("/summary", response_model=PracticeSummary)
def summary(
    today: date | None = Query(default=None), db: Session = Depends(get_db)
) -> PracticeSummary:
    """Return what to revise today, what is coming up, and how topics are going."""
    reference = today or date.today()
    problems = _all_problems(db)
    outs = [_out(p, reference) for p in problems]

    due = sorted(
        (o for o in outs if o.due_on and o.due_on <= reference.isoformat()),
        key=lambda o: (o.due_on, o.id),
    )
    upcoming = sorted(
        (o for o in outs if o.due_on and o.due_on > reference.isoformat()),
        key=lambda o: (o.due_on, o.id),
    )[:8]

    by_topic: dict[str, list[Problem]] = defaultdict(list)
    for problem in problems:
        by_topic[problem.topic].append(problem)
    topics = []
    for topic, items in by_topic.items():
        stat = practice.TopicStat(
            topic=topic,
            problems=len(items),
            needed_hint=sum(1 for p in items if p.needed_hint),
            revisions=sum(len(p.reviews) for p in items),
            forgotten=sum(1 for p in items for r in p.reviews if r.outcome == "forgot"),
            mastered=sum(1 for p in items if _schedule(p).mastered),
        )
        topics.append(
            TopicStatOut(
                topic=stat.topic,
                problems=stat.problems,
                needed_hint=stat.needed_hint,
                revisions=stat.revisions,
                forgotten=stat.forgotten,
                mastered=stat.mastered,
                struggle=round(stat.struggle, 3),
            )
        )
    # Weakest first: that is where the next problem should come from.
    topics.sort(key=lambda t: (-t.struggle, -t.problems, t.topic))

    return PracticeSummary(
        due_today=due,
        upcoming=upcoming,
        topics=topics,
        total_problems=len(outs),
        mastered=sum(1 for o in outs if o.mastered),
    )


@router.get("/problems", response_model=list[ProblemOut])
def list_problems(
    topic: str | None = Query(default=None),
    today: date | None = Query(default=None),
    db: Session = Depends(get_db),
) -> list[ProblemOut]:
    """Every logged problem, newest first, optionally for one topic."""
    reference = today or date.today()
    return [
        _out(p, reference) for p in _all_problems(db) if topic is None or p.topic == topic
    ]


@router.post("/problems", response_model=ProblemOut, status_code=status.HTTP_201_CREATED)
def create_problem(payload: ProblemCreate, db: Session = Depends(get_db)) -> ProblemOut:
    """Log a solved problem, and count it as one question that day."""
    if payload.category_id is not None:
        category = db.get(Category, payload.category_id)
        if category is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"No category with id {payload.category_id}",
            )
    else:
        category = repository.question_category(db)
    if category is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="No category with a question target to log problems against",
        )

    problem = Problem(
        category_id=category.id,
        title=payload.title.strip(),
        url=_clean(payload.url),
        topic=payload.topic.strip(),
        difficulty=payload.difficulty,
        needed_hint=payload.needed_hint,
        solved_on=payload.solved_on.isoformat(),
        notes=_clean(payload.notes),
    )
    db.add(problem)
    repository.bump_questions(db, category.id, problem.solved_on, +1)
    db.commit()
    db.refresh(problem)
    return _out(problem, date.today())


@router.patch("/problems/{problem_id}", response_model=ProblemOut)
def update_problem(
    problem_id: int, payload: ProblemUpdate, db: Session = Depends(get_db)
) -> ProblemOut:
    """Edit a problem. A new `solved_on` moves its question to that day."""
    problem = _get(db, problem_id)
    fields = payload.model_fields_set

    if "solved_on" in fields and payload.solved_on is not None:
        new_day = payload.solved_on.isoformat()
        first_review = min((r.reviewed_on for r in problem.reviews), default=None)
        if first_review is not None and new_day > first_review:
            # The same rule as recording a revision, kept from the other side.
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail=(
                    f"It was revised on {first_review}, so it can't have been solved "
                    "after that. Remove that revision first if it was a mistake."
                ),
            )
        if new_day != problem.solved_on:
            repository.bump_questions(db, problem.category_id, problem.solved_on, -1)
            repository.bump_questions(db, problem.category_id, new_day, +1)
            problem.solved_on = new_day
    if "title" in fields and payload.title is not None:
        problem.title = payload.title.strip()
    if "url" in fields:
        problem.url = _clean(payload.url)
    if "topic" in fields and payload.topic is not None:
        problem.topic = payload.topic.strip()
    if "difficulty" in fields and payload.difficulty is not None:
        problem.difficulty = payload.difficulty
    if "needed_hint" in fields and payload.needed_hint is not None:
        problem.needed_hint = payload.needed_hint
    if "notes" in fields:
        problem.notes = _clean(payload.notes)

    db.commit()
    db.refresh(problem)
    return _out(problem, date.today())


@router.delete("/problems/{problem_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_problem(problem_id: int, db: Session = Depends(get_db)) -> None:
    """Delete a problem and the question it counted."""
    problem = _get(db, problem_id)
    repository.bump_questions(db, problem.category_id, problem.solved_on, -1)
    db.delete(problem)
    db.commit()


@router.post("/problems/{problem_id}/reviews", response_model=ProblemOut)
def add_review(
    problem_id: int, payload: ReviewCreate, db: Session = Depends(get_db)
) -> ProblemOut:
    """Record a revision. It moves the schedule; it never counts a question."""
    problem = _get(db, problem_id)
    day = payload.reviewed_on or date.today()
    if day.isoformat() < problem.solved_on:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="A revision cannot come before the problem was solved",
        )
    problem.reviews.append(
        ProblemReview(reviewed_on=day.isoformat(), outcome=payload.outcome)
    )
    db.commit()
    db.refresh(problem)
    return _out(problem, date.today())


@router.delete("/problems/{problem_id}/reviews/{review_id}", response_model=ProblemOut)
def delete_review(
    problem_id: int, review_id: int, db: Session = Depends(get_db)
) -> ProblemOut:
    """Remove a revision recorded by mistake."""
    problem = _get(db, problem_id)
    review = next((r for r in problem.reviews if r.id == review_id), None)
    if review is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=f"No revision {review_id}"
        )
    problem.reviews.remove(review)
    db.commit()
    db.refresh(problem)
    return _out(problem, date.today())
