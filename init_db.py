# =============================================================
# init_db.py — Script de creation des tables dans PostgreSQL
# Role : A executer UNE SEULE FOIS pour creer les tables
# Commande : python init_db.py
# =============================================================

import sys
import os

# Forcer l'encodage UTF-8 pour le terminal Windows
sys.stdout.reconfigure(encoding='utf-8')

# Ajouter le dossier parent au chemin Python
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from backend.database.database import engine, Base
from backend.database import models

def creer_tables():
    print("=" * 50)
    print("RepairLens - Initialisation de la base de donnees")
    print("=" * 50)
    print()
    print("Connexion a PostgreSQL...")

    try:
        # Creer toutes les tables definies dans models.py
        Base.metadata.create_all(bind=engine)

        print()
        print("[OK] Tables creees avec succes !")
        print()
        print("Tables disponibles dans repairlens_db :")
        print("   -> sessions_reparation")
        print("   -> composants_detectes")
        print("   -> etapes_reparation")
        print()
        print("La base de donnees est prete !")
        print("=" * 50)

    except Exception as e:
        print()
        print(f"[ERREUR] Connexion echouee : {e}")
        print()
        print("Verifiez que :")
        print("   1. PostgreSQL est bien demarre sur votre PC")
        print("   2. La base 'repairlens_db' existe dans pgAdmin")
        print("   3. Le mot de passe dans .env est correct")
        print("=" * 50)

if __name__ == "__main__":
    creer_tables()
