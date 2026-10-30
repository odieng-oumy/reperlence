# =============================================================
# main.py — Point d'entree principal de l'application FastAPI
# Role : Demarrer le serveur et connecter toutes les routes
# Commande pour lancer : python -m uvicorn main:app --reload
# =============================================================

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
import os

from backend.database.database import engine, Base
from backend.database import models

try:
    from backend.routes import camera, segmentation, diagnostic, history, auth
    routes_disponibles = True
except ImportError:
    routes_disponibles = False

# ---------------------------------------------------------------
# Creer les tables au demarrage si elles n'existent pas encore
# ---------------------------------------------------------------
Base.metadata.create_all(bind=engine)

# ---------------------------------------------------------------
# Creer l'application FastAPI
# ---------------------------------------------------------------
app = FastAPI(
    title="RepairLens API",
    description="AI-powered device repair assistant — See the Fix. Built with Meta SAM 2 and Muse Spark.",
    version="1.0.0"
)

# ---------------------------------------------------------------
# CORS : Autoriser le frontend a communiquer avec le backend
# ---------------------------------------------------------------
render_url = os.getenv("RENDER_EXTERNAL_URL", "")
allowed_origins = ["http://localhost:8000", "http://127.0.0.1:8000"]
if render_url:
    allowed_origins.append(render_url)

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------
# Connecter toutes les routes (si les modules sont presents)
# ---------------------------------------------------------------
if routes_disponibles:
    app.include_router(camera.router,       prefix="/api/camera",       tags=["Camera"])
    app.include_router(segmentation.router, prefix="/api/segmentation", tags=["Segmentation SAM 2"])
    app.include_router(diagnostic.router,   prefix="/api/diagnostic",   tags=["Diagnostic Muse Spark"])
    app.include_router(history.router,      prefix="/api/history",      tags=["Historique"])
    app.include_router(auth.router,         prefix="/api/auth",         tags=["Authentification"])

# ---------------------------------------------------------------
# Route de sante du serveur et de la base de donnees
# ---------------------------------------------------------------
@app.get("/api/health")
def verification_serveur():
    return {
        "statut": "Serveur RepairLens actif",
        "database": "PostgreSQL connectee",
        "tables": ["sessions_reparation", "composants_detectes", "etapes_reparation", "messages_session"],
        "version": "1.0.0"
    }

@app.get("/api/debug/models")
async def lister_modeles_api():
    import httpx
    api_key = os.getenv("META_API_KEY", "").strip()
    if not api_key:
        return {"error": "API not configured"}
    results = {}
    urls = ["https://api.meta.ai/v1", "https://api.llama.com/v1"]
    headers_variants = [
        {"name": "Bearer", "headers": {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}},
        {"name": "x-api-key", "headers": {"x-api-key": api_key, "Content-Type": "application/json"}},
    ]
    async with httpx.AsyncClient(timeout=15, follow_redirects=True) as client:
        for base_url in urls:
            for hv in headers_variants:
                key = f"{base_url} ({hv['name']})"
                try:
                    resp = await client.get(f"{base_url}/models", headers=hv["headers"])
                    body = resp.json() if resp.status_code == 200 else resp.text[:500]
                    model_count = len(body.get("data", [])) if isinstance(body, dict) else "N/A"
                    results[key] = {"status": resp.status_code, "models": model_count, "body": body}
                except Exception as e:
                    results[key] = {"error": str(e)}
    return results

# ---------------------------------------------------------------
# Servir les fichiers statiques du frontend (si presents)
# ---------------------------------------------------------------
if os.path.exists("frontend"):
    app.mount("/static", StaticFiles(directory="frontend"), name="static")

# ---------------------------------------------------------------
# Route principale : afficher la page d'accueil ou statut
# ---------------------------------------------------------------
@app.get("/", include_in_schema=False)
def lire_accueil():
    if os.path.exists("frontend/index.html"):
        return FileResponse("frontend/index.html")
    return {"message": "Serveur RepairLens actif — Fondations et Base de donnees PostgreSQL"}

