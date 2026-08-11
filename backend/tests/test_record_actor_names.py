from types import SimpleNamespace

from app.services import audit_service, operations_service


class _Rows:
    def __init__(self, rows):
        self._rows = rows

    def all(self):
        return self._rows


class _QueuedScalars:
    def __init__(self, results):
        self._results = iter(results)

    def scalars(self, _statement):
        return _Rows(next(self._results))


def test_audit_records_resolve_the_actor_employee_name():
    db = _QueuedScalars([[SimpleNamespace(id='user-1', full_name='Asha Patel')]])
    rows = [
        SimpleNamespace(user_id='user-1'),
        SimpleNamespace(user_id=None),
    ]

    names = audit_service._audit_actor_names(db, rows)

    assert names == {'user-1': 'Asha Patel'}


def test_stock_records_use_action_actor_and_fall_back_to_creator():
    action = SimpleNamespace(
        entity_id='movement-1',
        user_id='user-action',
    )
    memberships = [
        SimpleNamespace(id='membership-1', user_id='user-creator-1'),
        SimpleNamespace(id='membership-2', user_id='user-creator-2'),
    ]
    users = [
        SimpleNamespace(id='user-action', full_name='Ravi Shah'),
        SimpleNamespace(id='user-creator-1', full_name='Original Creator'),
        SimpleNamespace(id='user-creator-2', full_name='Meera Joshi'),
    ]
    db = _QueuedScalars([[action], memberships, users])
    rows = [
        SimpleNamespace(id='movement-1', company_id='company-1', created_by='membership-1'),
        SimpleNamespace(id='movement-2', company_id='company-1', created_by='membership-2'),
    ]

    names = operations_service._movement_actor_names(db, rows)

    assert names == {
        'movement-1': 'Ravi Shah',
        'movement-2': 'Meera Joshi',
    }
