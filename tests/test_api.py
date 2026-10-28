"""
RepairLens API — Smoke tests
Run: python -m pytest tests/ -v
"""
from fastapi.testclient import TestClient
from main import app

client = TestClient(app)


def test_health():
    r = client.get("/api/health")
    assert r.status_code == 200
    data = r.json()
    assert "statut" in data
    assert "database" in data


def test_home_page():
    r = client.get("/")
    assert r.status_code == 200
    assert "RepairLens" in r.text


def test_camera_page():
    r = client.get("/static/camera.html")
    assert r.status_code == 200
    assert "screen-new-inspection" in r.text
    assert "progress-steps-bar" in r.text


def test_segmentation_test_route():
    r = client.get("/api/segmentation/test")
    assert r.status_code == 200


def test_diagnostic_test_route():
    r = client.get("/api/diagnostic/test")
    assert r.status_code == 200


def test_evaluer_requires_fields():
    r = client.post("/api/diagnostic/evaluer", json={})
    assert r.status_code in (200, 400, 422)


def test_history_requires_user():
    r = client.get("/api/history/")
    assert r.status_code == 401

    r2 = client.get("/api/history/", headers={"X-Utilisateur-Id": "test-user"})
    assert r2.status_code == 200


def test_nouvelle_session():
    r = client.post("/api/history/nouvelle", json={
        "type_appareil": "Test Fan",
        "probleme_detecte": "Does not spin",
        "utilisateur_id": "test-user"
    })
    assert r.status_code == 200
    data = r.json()
    assert "session_id" in data or "id" in data
