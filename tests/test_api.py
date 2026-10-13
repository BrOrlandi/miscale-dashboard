from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)


def test_ping():
    res = client.get("/api/ping")
    assert res.status_code == 200
    assert res.json() == {"ok": True}


def test_status():
    res = client.get("/api/status")
    assert res.status_code == 200
    data = res.json()
    assert "scanner" in data


def test_profile_crud():
    # Create
    res = client.post("/api/profiles", json={"name": "Test User", "height_cm": 178, "male": True})
    assert res.status_code == 200
    pid = res.json()["id"]

    # List
    res = client.get("/api/profiles")
    assert any(p["id"] == pid for p in res.json())

    # Update
    res = client.put(f"/api/profiles/{pid}", json={"name": "Updated User", "height_cm": 180, "male": True})
    assert res.status_code == 200
    assert res.json()["name"] == "Updated User"

    # Delete
    res = client.delete(f"/api/profiles/{pid}")
    assert res.status_code == 200
