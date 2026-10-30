# =============================================================
# database.py — Connexion à la base de données PostgreSQL
# Rôle : Créer et gérer la connexion unique à PostgreSQL
# =============================================================

from sqlalchemy import create_engine
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
import os
from dotenv import load_dotenv

# Charger les variables d'environnement depuis le fichier .env
load_dotenv()

# URL de connexion à PostgreSQL
# Render fournit postgres:// mais SQLAlchemy a besoin de postgresql+psycopg://
_raw_url = os.getenv("DATABASE_URL", "postgresql+psycopg://postgres:postgres@localhost:5432/repairlens_db")
if _raw_url.startswith("postgres://"):
    _raw_url = _raw_url.replace("postgres://", "postgresql+psycopg://", 1)
elif _raw_url.startswith("postgresql://") and "+psycopg" not in _raw_url:
    _raw_url = _raw_url.replace("postgresql://", "postgresql+psycopg://", 1)
DATABASE_URL = _raw_url

# Créer le moteur de connexion PostgreSQL
engine = create_engine(
    DATABASE_URL,
    echo=False
)

# Créer une fabrique de sessions (pour interagir avec la DB)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# Classe de base dont héritent tous nos modèles
Base = declarative_base()


# ---------------------------------------------------------------
# Fonction utilitaire : obtenir une session DB (utilisée dans les routes)
# ---------------------------------------------------------------
def get_db():
    """
    Génère une session de base de données.
    S'assure que la session est bien fermée après chaque requête.
    """
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
