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
# Format : postgresql://utilisateur:motdepasse@hote:port/nom_base
# psycopg3 utilise "postgresql+psycopg" au lieu de "postgresql"
DATABASE_URL = os.getenv("DATABASE_URL", "postgresql+psycopg://postgres:postgres@localhost:5432/repairlens_db")

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
