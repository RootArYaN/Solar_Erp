from __future__ import annotations

from typing import TYPE_CHECKING

from datetime import UTC, datetime, timedelta

from sqlalchemy import and_, case, func, or_, select
from sqlalchemy.orm import Session, joinedload, selectinload

if TYPE_CHECKING:
    from app.api.deps import CurrentSession
from app.models.auth import Membership, Role, User
from app.models.tasks import Task, TaskAssignment
from app.schemas.tasks import (
    CreateTaskRequest,
    TaskAssignmentSummary,
    TaskList,
    TaskMetrics,
    TaskOptions,
    TaskRoleOption,
    TaskSummary,
    TaskUserOption,
    UpdateTaskAssignmentRequest,
    UpdateTaskRequest,
)
from app.services.access_service import visible_customer_ids, visible_project_ids
from app.services.audit_service import write_event


class TaskServiceError(Exception):
    def __init__(self, message: str, status_code: int = 400):
        super().__init__(message)
        self.status_code = status_code


def _operational_task_filter(company_id: str):
    return and_(
        or_(
            Task.context_type != "customers",
            Task.context_id.is_(None),
            Task.context_id.in_(visible_customer_ids(company_id)),
        ),
        or_(
            Task.context_type != "projects",
            Task.context_id.is_(None),
            Task.context_id.in_(visible_project_ids(company_id)),
        ),
    )


TASK_LOAD_OPTIONS = (
    joinedload(Task.creator).joinedload(Membership.user),
    selectinload(Task.assignments).joinedload(TaskAssignment.membership).joinedload(Membership.user),
    selectinload(Task.assignments).joinedload(TaskAssignment.membership).joinedload(Membership.role),
    selectinload(Task.assignments).joinedload(TaskAssignment.source_role),
)


def _has_permission(actor: CurrentSession, permission: str) -> bool:
    return actor.user.is_super_admin or permission in actor.permissions


def _can_assign(actor: CurrentSession) -> bool:
    return _has_permission(actor, "tasks.assign") or _has_permission(actor, "tasks.manage")


def _can_manage(actor: CurrentSession) -> bool:
    return _has_permission(actor, "tasks.manage")


def _normalize_due_at(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    return value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)


def _load_task(
    db: Session,
    actor: CurrentSession,
    task_id: str,
    *,
    for_update: bool = False,
) -> Task:
    query = (
        select(Task)
        .where(
            Task.id == task_id,
            Task.company_id == actor.membership.company_id,
            _operational_task_filter(actor.membership.company_id),
        )
        .options(*TASK_LOAD_OPTIONS)
    )
    if for_update:
        query = query.with_for_update(of=Task)
    task = db.scalar(query)
    if task is None:
        raise TaskServiceError("Task not found", 404)
    return task


def _ensure_task_visible(task: Task, actor: CurrentSession) -> None:
    if _can_assign(actor):
        return
    if task.created_by == actor.membership.id:
        return
    if any(assignment.membership_id == actor.membership.id for assignment in task.assignments):
        return
    raise TaskServiceError("Task not found", 404)


def _overall_status(assignments: list[TaskAssignment]) -> str:
    statuses = {assignment.status for assignment in assignments}
    if statuses == {"done"}:
        return "done"
    if "blocked" in statuses:
        return "blocked"
    if "in_progress" in statuses or "done" in statuses:
        return "in_progress"
    return "todo"


def _overall_progress(assignments: list[TaskAssignment]) -> int:
    if not assignments:
        return 0
    return round(sum(assignment.progress for assignment in assignments) / len(assignments))


def _task_summary(task: Task, actor: CurrentSession) -> TaskSummary:
    assignments = sorted(
        task.assignments,
        key=lambda item: (item.status == "done", item.membership.user.full_name.lower()),
    )
    mine = any(assignment.membership_id == actor.membership.id for assignment in assignments)
    now = datetime.now(UTC)
    due_at = _normalize_due_at(task.due_at)
    status = _overall_status(assignments)
    can_edit = _can_manage(actor) or task.created_by == actor.membership.id
    return TaskSummary(
        id=task.id,
        version=task.version,
        title=task.title,
        description=task.description,
        priority=task.priority,
        context_type=task.context_type,
        context_id=task.context_id,
        due_at=due_at,
        created_by_membership_id=task.created_by,
        created_by_name=task.creator.user.full_name,
        created_at=task.created_at,
        updated_at=task.updated_at,
        status=status,
        progress=_overall_progress(assignments),
        overdue=bool(due_at and due_at < now and status != "done"),
        is_mine=mine,
        can_edit=can_edit,
        can_delete=can_edit,
        can_manage_assignments=_can_manage(actor),
        assignments=[
            TaskAssignmentSummary(
                id=assignment.id,
                membership_id=assignment.membership_id,
                assignee_name=assignment.membership.user.full_name,
                role_code=assignment.membership.role.code,
                source_role_id=assignment.source_role_id,
                source_role_name=assignment.source_role.name if assignment.source_role else None,
                status=assignment.status,
                progress=assignment.progress,
                note=assignment.note,
                completed_at=assignment.completed_at,
                updated_at=assignment.updated_at,
            )
            for assignment in assignments
        ],
    )


def _resolve_assignees(
    db: Session,
    actor: CurrentSession,
    membership_ids: list[str],
    role_ids: list[str],
) -> dict[str, str | None]:
    company_id = actor.membership.company_id
    explicit_ids = set(membership_ids)
    requested_role_ids = set(role_ids)

    if (explicit_ids - {actor.membership.id} or requested_role_ids) and not _can_assign(actor):
        raise TaskServiceError("You cannot assign tasks to other users or roles", 403)

    targets: dict[str, str | None] = {}
    if explicit_ids:
        rows = db.execute(
            select(Membership.id)
            .join(User, User.id == Membership.user_id)
            .where(
                Membership.company_id == company_id,
                Membership.id.in_(explicit_ids),
                Membership.is_active.is_(True),
                User.is_active.is_(True),
            )
        ).scalars().all()
        found = set(rows)
        missing = explicit_ids - found
        if missing:
            raise TaskServiceError("One or more selected users are unavailable", 404)
        targets.update({membership_id: None for membership_id in found})

    if requested_role_ids:
        valid_role_ids = set(
            db.execute(
                select(Role.id).where(Role.company_id == company_id, Role.id.in_(requested_role_ids))
            ).scalars().all()
        )
        if valid_role_ids != requested_role_ids:
            raise TaskServiceError("One or more selected roles are unavailable", 404)
        role_members = db.execute(
            select(Membership.id, Membership.role_id)
            .join(User, User.id == Membership.user_id)
            .where(
                Membership.company_id == company_id,
                Membership.role_id.in_(valid_role_ids),
                Membership.is_active.is_(True),
                User.is_active.is_(True),
            )
        ).all()
        for membership_id, role_id in role_members:
            targets.setdefault(str(membership_id), str(role_id))

    selection_requested = bool(explicit_ids or requested_role_ids)
    if not targets and selection_requested:
        raise TaskServiceError("Selected roles do not contain any active users", 422)
    if not targets:
        targets[actor.membership.id] = None
    return targets


def list_tasks(
    db: Session,
    actor: CurrentSession,
    *,
    scope: str,
    q: str | None,
    status: str | None,
    priority: str | None,
    assignee_id: str | None,
    due_from: datetime | None,
    due_to: datetime | None,
    page: int,
    page_size: int,
) -> TaskList:
    if scope == "team" and not _can_assign(actor):
        raise TaskServiceError("Team task access requires assignment permission", 403)

    actor_id = actor.membership.id
    filters = [Task.company_id == actor.membership.company_id, _operational_task_filter(actor.membership.company_id)]
    if scope == "mine":
        filters.append(Task.assignments.any(TaskAssignment.membership_id == actor_id))
    if q:
        pattern = f"%{q.strip()}%"
        filters.append(or_(Task.title.ilike(pattern), Task.description.ilike(pattern)))
    if priority:
        filters.append(Task.priority == priority)
    if assignee_id:
        filters.append(Task.assignments.any(TaskAssignment.membership_id == assignee_id))
    if status:
        if scope == "mine":
            filters.append(Task.assignments.any(and_(
                TaskAssignment.membership_id == actor_id,
                TaskAssignment.status == status,
            )))
        elif status == "done":
            filters.append(~Task.assignments.any(TaskAssignment.status != "done"))
        elif status == "blocked":
            filters.append(Task.assignments.any(TaskAssignment.status == "blocked"))
        elif status == "in_progress":
            filters.extend((
                ~Task.assignments.any(TaskAssignment.status == "blocked"),
                Task.assignments.any(TaskAssignment.status.in_(("in_progress", "done"))),
                Task.assignments.any(TaskAssignment.status != "done"),
            ))
        else:
            filters.append(~Task.assignments.any(TaskAssignment.status != "todo"))
    if due_from:
        filters.append(Task.due_at >= _normalize_due_at(due_from))
    if due_to:
        filters.append(Task.due_at <= _normalize_due_at(due_to))

    total = db.scalar(select(func.count()).select_from(Task).where(*filters)) or 0
    priority_order = case(
        (Task.priority == "urgent", 0),
        (Task.priority == "high", 1),
        (Task.priority == "normal", 2),
        else_=3,
    )
    rows = list(
        db.scalars(
            select(Task)
            .where(*filters)
            .options(*TASK_LOAD_OPTIONS)
            .order_by(Task.due_at.asc().nullslast(), priority_order, Task.updated_at.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
        ).all()
    )
    return TaskList(
        data=[_task_summary(task, actor) for task in rows],
        page=page,
        page_size=page_size,
        total=total,
    )


def task_metrics(db: Session, actor: CurrentSession) -> TaskMetrics:
    now = datetime.now(UTC)
    today_start = datetime(now.year, now.month, now.day, tzinfo=UTC)
    tomorrow = today_start + timedelta(days=1)
    mine = db.execute(
        select(
            func.count(TaskAssignment.id).filter(TaskAssignment.status != "done"),
            func.count(TaskAssignment.id).filter(
                TaskAssignment.status != "done", Task.due_at.is_not(None), Task.due_at < now
            ),
            func.count(TaskAssignment.id).filter(
                TaskAssignment.status != "done", Task.due_at >= today_start, Task.due_at < tomorrow
            ),
            func.count(TaskAssignment.id).filter(TaskAssignment.status == "done"),
        )
        .select_from(TaskAssignment)
        .join(Task, Task.id == TaskAssignment.task_id)
        .where(
            Task.company_id == actor.membership.company_id,
            _operational_task_filter(actor.membership.company_id),
            TaskAssignment.membership_id == actor.membership.id,
        )
    ).one()

    team_open = 0
    team_overdue = 0
    if _can_assign(actor):
        team = db.execute(
            select(
                func.count(func.distinct(Task.id)).filter(TaskAssignment.status != "done"),
                func.count(func.distinct(Task.id)).filter(
                    TaskAssignment.status != "done",
                    Task.due_at.is_not(None),
                    Task.due_at < now,
                ),
            )
            .select_from(Task)
            .join(TaskAssignment, TaskAssignment.task_id == Task.id)
            .where(
                Task.company_id == actor.membership.company_id,
                _operational_task_filter(actor.membership.company_id),
            )
        ).one()
        team_open = int(team[0] or 0)
        team_overdue = int(team[1] or 0)

    return TaskMetrics(
        my_open=int(mine[0] or 0),
        my_overdue=int(mine[1] or 0),
        my_due_today=int(mine[2] or 0),
        my_completed=int(mine[3] or 0),
        team_open=int(team_open),
        team_overdue=int(team_overdue),
    )


def task_options(db: Session, actor: CurrentSession) -> TaskOptions:
    if not _can_assign(actor):
        return TaskOptions(
            users=[TaskUserOption(
                membership_id=actor.membership.id,
                full_name=actor.user.full_name,
                role_code=actor.role,
            )],
            roles=[],
        )

    company_id = actor.membership.company_id
    memberships = db.execute(
        select(Membership.id, User.full_name, Role.code)
        .join(User, User.id == Membership.user_id)
        .join(Role, Role.id == Membership.role_id)
        .where(
            Membership.company_id == company_id,
            Membership.is_active.is_(True),
            User.is_active.is_(True),
        )
        .order_by(User.full_name.asc())
    ).all()
    roles = db.execute(
        select(Role.id, Role.name, Role.code, func.count(User.id))
        .outerjoin(
            Membership,
            and_(
                Membership.role_id == Role.id,
                Membership.company_id == company_id,
                Membership.is_active.is_(True),
            ),
        )
        .outerjoin(
            User,
            and_(
                User.id == Membership.user_id,
                User.is_active.is_(True),
            ),
        )
        .where(Role.company_id == company_id)
        .group_by(Role.id, Role.name, Role.code)
        .order_by(Role.name.asc())
    ).all()
    return TaskOptions(
        users=[
            TaskUserOption(membership_id=str(row[0]), full_name=str(row[1]), role_code=str(row[2]))
            for row in memberships
        ],
        roles=[
            TaskRoleOption(id=str(row[0]), name=str(row[1]), code=str(row[2]), member_count=int(row[3] or 0))
            for row in roles
        ],
    )


def create_task(db: Session, actor: CurrentSession, payload: CreateTaskRequest) -> TaskSummary:
    targets = _resolve_assignees(
        db,
        actor,
        payload.assignee_membership_ids,
        payload.assignee_role_ids,
    )
    task = Task(
        company_id=actor.membership.company_id,
        title=payload.title,
        description=payload.description,
        priority=payload.priority,
        context_type=payload.context_type,
        context_id=payload.context_id,
        due_at=_normalize_due_at(payload.due_at),
        created_by=actor.membership.id,
    )
    db.add(task)
    db.flush()
    db.add_all([
        TaskAssignment(
            task_id=task.id,
            membership_id=membership_id,
            source_role_id=source_role_id,
            assigned_by=actor.membership.id,
        )
        for membership_id, source_role_id in targets.items()
    ])
    write_event(
        db,
        company_id=actor.membership.company_id,
        event="task.created",
        entity="task",
        entity_id=task.id,
        actor=actor,
        changes={
            "title": task.title,
            "priority": task.priority,
            "assignee_count": len(targets),
            "due_at": task.due_at,
        },
    )
    db.commit()
    return _task_summary(_load_task(db, actor, task.id), actor)


def update_task(
    db: Session,
    actor: CurrentSession,
    task_id: str,
    payload: UpdateTaskRequest,
) -> TaskSummary:
    task = _load_task(db, actor, task_id, for_update=True)
    _ensure_task_visible(task, actor)
    if not (_can_manage(actor) or task.created_by == actor.membership.id):
        raise TaskServiceError("Only the task creator or an administrator can edit this task", 403)
    if payload.expected_version is not None and payload.expected_version != task.version:
        raise TaskServiceError("This task changed after you opened it. Refresh and try again", 409)

    fields = payload.model_fields_set
    changes: dict[str, object] = {}
    for field in ("title", "description", "priority", "context_type", "context_id"):
        if field in fields:
            value = getattr(payload, field)
            setattr(task, field, value)
            changes[field] = value
    if "due_at" in fields:
        task.due_at = _normalize_due_at(payload.due_at)
        changes["due_at"] = task.due_at

    assignments_changed = "assignee_membership_ids" in fields or "assignee_role_ids" in fields
    if assignments_changed:
        if not _can_assign(actor):
            raise TaskServiceError("You cannot change task assignees", 403)
        targets = _resolve_assignees(
            db,
            actor,
            payload.assignee_membership_ids or [],
            payload.assignee_role_ids or [],
        )
        existing = {assignment.membership_id: assignment for assignment in task.assignments}
        for membership_id, assignment in existing.items():
            if membership_id not in targets:
                db.delete(assignment)
        for membership_id, source_role_id in targets.items():
            assignment = existing.get(membership_id)
            if assignment is None:
                db.add(TaskAssignment(
                    task_id=task.id,
                    membership_id=membership_id,
                    source_role_id=source_role_id,
                    assigned_by=actor.membership.id,
                ))
            else:
                assignment.source_role_id = source_role_id
        changes["assignee_count"] = len(targets)

    task.version += 1
    write_event(
        db,
        company_id=actor.membership.company_id,
        event="task.updated",
        entity="task",
        entity_id=task.id,
        actor=actor,
        changes=changes,
    )
    db.commit()
    return _task_summary(_load_task(db, actor, task.id), actor)


def update_assignment(
    db: Session,
    actor: CurrentSession,
    task_id: str,
    assignment_id: str | None,
    payload: UpdateTaskAssignmentRequest,
) -> TaskSummary:
    task = _load_task(db, actor, task_id, for_update=True)
    _ensure_task_visible(task, actor)
    if payload.expected_version is not None and payload.expected_version != task.version:
        raise TaskServiceError("This task changed after you opened it. Refresh and try again", 409)
    target_id = assignment_id
    if target_id is None:
        assignment = next(
            (item for item in task.assignments if item.membership_id == actor.membership.id),
            None,
        )
    else:
        if not _can_manage(actor):
            raise TaskServiceError("Only an administrator can update another user's task progress", 403)
        assignment = next((item for item in task.assignments if item.id == target_id), None)
    if assignment is None:
        raise TaskServiceError("Task assignment not found", 404)

    if payload.note is not None:
        assignment.note = payload.note
    if payload.progress is not None:
        assignment.progress = payload.progress
    if payload.status is not None:
        assignment.status = payload.status

    if assignment.progress >= 100 or assignment.status == "done":
        assignment.status = "done"
        assignment.progress = 100
        assignment.completed_at = assignment.completed_at or datetime.now(UTC)
    else:
        assignment.completed_at = None
        if payload.status == "todo":
            assignment.progress = 0
        elif assignment.status == "todo" and assignment.progress > 0:
            assignment.status = "in_progress"
        elif assignment.status == "in_progress" and assignment.progress == 0:
            assignment.progress = 10

    task.version += 1
    write_event(
        db,
        company_id=actor.membership.company_id,
        event="task.assignment_updated",
        entity="task",
        entity_id=task.id,
        actor=actor,
        changes={
            "assignment_id": assignment.id,
            "membership_id": assignment.membership_id,
            "status": assignment.status,
            "progress": assignment.progress,
        },
    )
    db.commit()
    return _task_summary(_load_task(db, actor, task.id), actor)


def delete_task(
    db: Session,
    actor: CurrentSession,
    task_id: str,
    expected_version: int,
) -> None:
    task = _load_task(db, actor, task_id, for_update=True)
    _ensure_task_visible(task, actor)
    if expected_version != task.version:
        raise TaskServiceError("This task changed after you opened it. Refresh and try again", 409)
    if not (_can_manage(actor) or task.created_by == actor.membership.id):
        raise TaskServiceError("Only the task creator or an administrator can delete this task", 403)
    write_event(
        db,
        company_id=actor.membership.company_id,
        event="task.deleted",
        entity="task",
        entity_id=task.id,
        actor=actor,
        changes={"title": task.title},
    )
    db.delete(task)
    db.commit()
