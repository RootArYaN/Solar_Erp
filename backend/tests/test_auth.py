from fastapi.testclient import TestClient

from app.main import app


def test_seeded_login_and_me() -> None:
    with TestClient(app) as client:
        response = client.post(
            "/api/v1/auth/login",
            json={
                "email": "admin@solarerp.dev",
                "password": "ChangeMe123!",
                "company_code": "SHREE",
            },
        )
        assert response.status_code == 200

        session = response.json()
        assert session["company"]["code"] == "SHREE"
        assert "company_admin" in session["roles"]

        me = client.get(
            "/api/v1/auth/me",
            headers={"Authorization": f"Bearer {session['access_token']}"},
        )
        assert me.status_code == 200
        assert me.json()["user"]["email"] == "admin@solarerp.dev"
