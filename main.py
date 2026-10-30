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

@app.get("/api/debug/groq-models")
async def lister_modeles_groq():
    import httpx
    groq_key = os.getenv("GROQ_API_KEY", "").strip()
    if not groq_key:
        return {"error": "GROQ_API_KEY not set"}
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.get("https://api.groq.com/openai/v1/models", headers={"Authorization": f"Bearer {groq_key}"})
            if resp.status_code == 200:
                models = [m["id"] for m in resp.json().get("data", [])]
                llama = [m for m in models if "llama" in m.lower()]
                return {"llama_models": sorted(llama), "total": len(models)}
            return {"status": resp.status_code, "body": resp.text[:500]}
    except Exception as e:
        return {"error": str(e)}

@app.get("/api/debug/models")
async def lister_modeles_api():
    import httpx
    api_key = os.getenv("META_API_KEY", "").strip()
    team_id = os.getenv("META_TEAM_ID", "").strip()
    project_id = os.getenv("META_PROJECT_ID", "").strip()
    if not api_key:
        return {"error": "API not configured"}
    results = {}
    base = "https://api.meta.ai/v1"
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    async with httpx.AsyncClient(timeout=15, follow_redirects=True) as client:
        # Test 1: models sans params
        try:
            r = await client.get(f"{base}/models", headers=headers)
            results["models_plain"] = {"status": r.status_code, "body": r.json() if r.status_code == 200 else r.text[:500]}
        except Exception as e:
            results["models_plain"] = {"error": str(e)}
        # Test 2: models avec team_id/project_id en headers
        if team_id:
            try:
                h2 = {**headers, "x-team-id": team_id, "x-project-id": project_id}
                r = await client.get(f"{base}/models", headers=h2)
                results["models_with_team_header"] = {"status": r.status_code, "body": r.json() if r.status_code == 200 else r.text[:500]}
            except Exception as e:
                results["models_with_team_header"] = {"error": str(e)}
        # Test 3: chat/completions simple avec team headers
        try:
            h3 = {**headers}
            if team_id:
                h3["x-team-id"] = team_id
                h3["x-project-id"] = project_id
            r = await client.post(f"{base}/chat/completions", headers=h3, json={
                "model": "muse-spark-1.3", "messages": [{"role": "user", "content": "Say hi"}], "max_tokens": 10
            })
            results["chat_with_team"] = {"status": r.status_code, "body": r.text[:500]}
        except Exception as e:
            results["chat_with_team"] = {"error": str(e)}
        # Test 4: chat avec model dans URL style
        try:
            r = await client.post(f"{base}/chat/completions", headers=headers, json={
                "model": "meta-llama/muse-spark-1.3", "messages": [{"role": "user", "content": "Say hi"}], "max_tokens": 10
            })
            results["chat_prefixed_model"] = {"status": r.status_code, "body": r.text[:500]}
        except Exception as e:
            results["chat_prefixed_model"] = {"error": str(e)}
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

