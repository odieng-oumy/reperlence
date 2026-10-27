# =============================================================
# __init__.py — Fichier d'initialisation du module database
# Rôle : Rendre le dossier database importable comme un module Python
# =============================================================

from .database import Base, engine, get_db
from . import models, crud
