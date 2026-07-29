import sys
import types

fake_session = types.ModuleType('app.db.session')
fake_session.SessionLocal = lambda: None
fake_session.get_db = lambda: None
fake_session.engine = object()
sys.modules['app.db.session'] = fake_session

from app.main import app


def test_openapi_contains_expected_api_surface():
    schema = app.openapi()
    paths = schema['paths']
    assert len(paths) == 69
    assert 'delete' in paths['/api/v1/files/{file_id}']
    assert 'patch' not in paths['/api/v1/files/{file_id}']
    assert '/api/v1/auth/login' in paths
    assert '/api/v1/auth/refresh' in paths
    assert '/api/v1/auth/logout' in paths


def test_production_docs_are_not_part_of_api_contract():
    # Docs are environment-controlled and are not business API routes.
    schema = app.openapi()
    assert '/docs' not in schema['paths']
    assert '/redoc' not in schema['paths']
