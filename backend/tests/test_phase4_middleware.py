import sys
import types

fake_session = types.ModuleType('app.db.session')
fake_session.SessionLocal = lambda: None
fake_session.get_db = lambda: None
sys.modules['app.db.session'] = fake_session

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.core.middleware import add_error_handlers, add_request_middleware
from app.core.security import create_access_token, create_csrf_token


def _client() -> TestClient:
    app = FastAPI()
    add_request_middleware(app)
    add_error_handlers(app)

    @app.get('/api/v1/ping')
    def ping():
        return {'ok': True}

    @app.post('/api/v1/change')
    def change():
        return {'ok': True}

    return TestClient(app)


def _token(session_id: str = 'session-a') -> str:
    token, _ = create_access_token(
        'user-a',
        {
            'company_id': 'company-a',
            'membership_id': 'membership-a',
            'auth_session_id': session_id,
        },
    )
    return token


def test_api_security_headers_and_request_id_are_present():
    response = _client().get('/api/v1/ping')
    assert response.status_code == 200
    assert response.headers['x-content-type-options'] == 'nosniff'
    assert response.headers['x-frame-options'] == 'DENY'
    assert response.headers['cache-control'] == 'no-store, max-age=0'
    assert response.headers['content-security-policy'].startswith("default-src 'none'")
    assert response.headers['x-request-id']


def test_disallowed_origin_is_rejected_before_route_execution():
    response = _client().post('/api/v1/change', headers={'Origin': 'https://evil.example'})
    assert response.status_code == 403
    assert response.json()['code'] == 'origin_rejected'


def test_bearer_mutation_requires_session_bound_csrf_token():
    token = _token()
    headers = {
        'Authorization': f'Bearer {token}',
        'Origin': 'http://localhost:5173',
    }
    rejected = _client().post('/api/v1/change', headers=headers)
    assert rejected.status_code == 403
    assert rejected.json()['code'] == 'csrf_rejected'

    accepted = _client().post(
        '/api/v1/change',
        headers={**headers, 'X-CSRF-Token': create_csrf_token('session-a')},
    )
    assert accepted.status_code == 200


def test_csrf_token_for_another_session_is_rejected():
    response = _client().post(
        '/api/v1/change',
        headers={
            'Authorization': f'Bearer {_token("session-a")}',
            'Origin': 'http://localhost:5173',
            'X-CSRF-Token': create_csrf_token('session-b'),
        },
    )
    assert response.status_code == 403
    assert response.json()['code'] == 'csrf_rejected'
