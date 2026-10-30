from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session
import os, json, base64

from backend.database.database import get_db
from backend.database import crud

router = APIRouter()


@router.get("/config")
def get_auth_config():
    client_id = os.getenv("GOOGLE_CLIENT_ID", "")
    return {"google_client_id": client_id}


@router.post("/google")
def google_login(body: dict, db: Session = Depends(get_db)):
    credential = body.get("credential", "")
    old_uid = body.get("old_uid", "")

    try:
        parts = credential.split(".")
        payload = parts[1]
        payload += "=" * (4 - len(payload) % 4)
        decoded = json.loads(base64.urlsafe_b64decode(payload))
    except Exception:
        return JSONResponse(status_code=400, content={"error": "Invalid token"})

    google_sub = decoded.get("sub", "")
    name = decoded.get("name", "")
    email = decoded.get("email", "")
    picture = decoded.get("picture", "")

    if not google_sub:
        return JSONResponse(status_code=400, content={"error": "No sub in token"})

    new_uid = f"google_{google_sub}"

    if old_uid and old_uid != new_uid:
        nb = crud.migrer_sessions_utilisateur(db, old_uid, new_uid, name)
        print(f"[AUTH] Migrated {nb} sessions from {old_uid} to {new_uid}")

    return {
        "utilisateur_id": new_uid,
        "nom": name,
        "email": email,
        "photo": picture
    }
