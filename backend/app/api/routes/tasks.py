from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy.orm import Session

from app.api.deps import CurrentSession, require_permissions
from app.core.config import settings
from app.db.session import get_db
from app.schemas.tasks import (
    CreateTaskRequest,
    TaskList,
    TaskMetrics,
    TaskOptions,
    TaskSummary,
    UpdateTaskAssignmentRequest,
    UpdateTaskRequest,
)
from app.services import tasks_service
from app.services.tasks_service import TaskServiceError

router = APIRouter(prefix="/tasks", tags=["tasks"])


def _raise(exc: TaskServiceError) -> None:
    raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc


@router.get("", response_model=TaskList)
def get_tasks(
    scope: str = Query(default="mine", pattern=r"^(mine|team)$"),
    q: str | None = Query(default=None, max_length=120),
    status_filter: str | None = Query(default=None, alias="status", pattern=r"^(todo|in_progress|blocked|done)$"),
    priority: str | None = Query(default=None, pattern=r"^(low|normal|high|urgent)$"),
    assignee_id: str | None = None,
    due_from: datetime | None = None,
    due_to: datetime | None = None,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=settings.default_page_size, ge=1, le=settings.max_page_size),
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(require_permissions("tasks.view")),
) -> TaskList:
    try:
        return tasks_service.list_tasks(
            db,
            session,
            scope=scope,
            q=q,
            status=status_filter,
            priority=priority,
            assignee_id=assignee_id,
            due_from=due_from,
            due_to=due_to,
            page=page,
            page_size=page_size,
        )
    except TaskServiceError as exc:
        _raise(exc)


@router.get("/metrics", response_model=TaskMetrics)
def get_task_metrics(
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(require_permissions("tasks.view")),
) -> TaskMetrics:
    return tasks_service.task_metrics(db, session)


@router.get("/options", response_model=TaskOptions)
def get_task_options(
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(require_permissions("tasks.view")),
) -> TaskOptions:
    return tasks_service.task_options(db, session)


@router.post("", response_model=TaskSummary, status_code=status.HTTP_201_CREATED)
def post_task(
    payload: CreateTaskRequest,
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(require_permissions("tasks.create")),
) -> TaskSummary:
    try:
        return tasks_service.create_task(db, session, payload)
    except TaskServiceError as exc:
        _raise(exc)


@router.patch("/{task_id}", response_model=TaskSummary)
def patch_task(
    task_id: str,
    payload: UpdateTaskRequest,
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(require_permissions("tasks.view")),
) -> TaskSummary:
    try:
        return tasks_service.update_task(db, session, task_id, payload)
    except TaskServiceError as exc:
        _raise(exc)


@router.patch("/{task_id}/my-assignment", response_model=TaskSummary)
def patch_my_task_assignment(
    task_id: str,
    payload: UpdateTaskAssignmentRequest,
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(require_permissions("tasks.view")),
) -> TaskSummary:
    try:
        return tasks_service.update_assignment(db, session, task_id, None, payload)
    except TaskServiceError as exc:
        _raise(exc)


@router.patch("/{task_id}/assignments/{assignment_id}", response_model=TaskSummary)
def patch_task_assignment(
    task_id: str,
    assignment_id: str,
    payload: UpdateTaskAssignmentRequest,
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(require_permissions("tasks.manage")),
) -> TaskSummary:
    try:
        return tasks_service.update_assignment(db, session, task_id, assignment_id, payload)
    except TaskServiceError as exc:
        _raise(exc)


@router.delete("/{task_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_task(
    task_id: str,
    expected_version: int = Query(ge=1),
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(require_permissions("tasks.view")),
) -> Response:
    try:
        tasks_service.delete_task(db, session, task_id, expected_version)
    except TaskServiceError as exc:
        _raise(exc)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
