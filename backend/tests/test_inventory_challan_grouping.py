from types import SimpleNamespace

from app.services import operations_service


class ScalarRows:
    def __init__(self, rows):
        self.rows = rows

    def all(self):
        return self.rows


class ChallanDB:
    def __init__(self, movement, rows):
        self.movement = movement
        self.rows = rows
        self.statement = None

    def scalar(self, _statement):
        return self.movement

    def scalars(self, statement):
        self.statement = statement
        return ScalarRows(self.rows)


def actor():
    return SimpleNamespace(membership=SimpleNamespace(company_id='company-1'))


def movement(**overrides):
    values = {
        'id': 'movement-1',
        'movement_group_id': 'group-1',
        'challan_id': None,
        'reference_number': 'CH-2026-001',
    }
    values.update(overrides)
    return SimpleNamespace(**values)


def test_challan_download_loads_the_complete_movement_batch(monkeypatch):
    first = movement()
    second = movement(id='movement-2')
    db = ChallanDB(first, [first, second])
    monkeypatch.setattr(operations_service, '_movement_summaries', lambda _db, rows: rows)

    result = operations_service.get_inventory_challan_movements(db, actor(), first.id)

    assert result == [first, second]
    statement = str(db.statement.compile(compile_kwargs={'literal_binds': True}))
    assert "inventory_movements.movement_group_id = 'group-1'" in statement


def test_legacy_challan_download_uses_the_exact_reference_number(monkeypatch):
    legacy = movement(movement_group_id=None)
    db = ChallanDB(legacy, [legacy])
    monkeypatch.setattr(operations_service, '_movement_summaries', lambda _db, rows: rows)

    operations_service.get_inventory_challan_movements(db, actor(), legacy.id)

    statement = str(db.statement.compile(compile_kwargs={'literal_binds': True}))
    assert "inventory_movements.reference_number = 'CH-2026-001'" in statement
