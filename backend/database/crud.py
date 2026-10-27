# =============================================================
# crud.py — Opérations sur la base de données (CRUD)
# Rôle : Toutes les fonctions pour Créer, Lire, Modifier, Supprimer
# CRUD = Create, Read, Update, Delete
# =============================================================

from sqlalchemy.orm import Session
from . import models


# ===============================================================
# SESSIONS DE RÉPARATION
# ===============================================================

def creer_session(db: Session, type_appareil: str, marque: str = None,
                  probleme_detecte: str = None, utilisateur_id: str = None,
                  nom_utilisateur: str = None, image_miniature: str = None):
    """
    Crée une nouvelle session de réparation dans la base de données.
    Appelée quand l'utilisateur commence une nouvelle réparation.
    """
    nouvelle_session = models.SessionReparation(
        type_appareil=type_appareil,
        marque=marque,
        probleme_detecte=probleme_detecte,
        utilisateur_id=utilisateur_id,
        nom_utilisateur=nom_utilisateur,
        image_miniature=image_miniature,
        statut=models.StatutSession.EN_COURS
    )
    db.add(nouvelle_session)
    db.commit()
    db.refresh(nouvelle_session)
    return nouvelle_session


def obtenir_session(db: Session, session_id: int):
    """
    Récupère une session spécifique par son identifiant.
    """
    return db.query(models.SessionReparation).filter(
        models.SessionReparation.id == session_id
    ).first()


def obtenir_toutes_sessions(db: Session, utilisateur_id: str = None, limite: int = 50):
    """
    Récupère les sessions de réparation d'un utilisateur spécifique (pour son historique personnel).
    Limitée à 50 par défaut pour la performance.
    """
    requete = db.query(models.SessionReparation)
    if utilisateur_id:
        requete = requete.filter(models.SessionReparation.utilisateur_id == utilisateur_id)
    return requete.order_by(models.SessionReparation.date_creation.desc())\
                  .limit(limite)\
                  .all()


def mettre_a_jour_session(db: Session, session_id: int, diagnostic: str = None,
                          statut: str = None, probleme_detecte: str = None,
                          nom_utilisateur: str = None, image_miniature: str = None):
    """
    Met à jour le diagnostic et/ou le statut d'une session.
    Appelée quand Muse Spark retourne le diagnostic ou quand la session est résolue.
    """
    session = obtenir_session(db, session_id)
    if session:
        if diagnostic:
            session.diagnostic_ia = diagnostic
        if statut:
            session.statut = statut
        if probleme_detecte:
            session.probleme_detecte = probleme_detecte
        if nom_utilisateur:
            session.nom_utilisateur = nom_utilisateur
        if image_miniature:
            session.image_miniature = image_miniature
        db.commit()
        db.refresh(session)
    return session


def supprimer_session(db: Session, session_id: int):
    """
    Supprime une session et tous ses composants/étapes associés.
    (Grâce au cascade="all, delete-orphan" dans le modèle)
    """
    session = obtenir_session(db, session_id)
    if session:
        db.delete(session)
        db.commit()
    return session


# ===============================================================
# COMPOSANTS DÉTECTÉS
# ===============================================================

def ajouter_composant(db: Session, session_id: int, nom: str,
                      pos_x: float, pos_y: float,
                      largeur: float, hauteur: float,
                      confiance: float, etat: str = "inconnu",
                      description: str = None):
    """
    Ajoute un composant détecté par SAM 3.1 dans la base de données.
    Stocke sa position spatiale pour le suivi entre les images.
    """
    composant = models.ComposantDetecte(
        session_id=session_id,
        nom=nom,
        description=description,
        pos_x=pos_x,
        pos_y=pos_y,
        largeur=largeur,
        hauteur=hauteur,
        confiance=confiance,
        etat=etat
    )
    db.add(composant)
    db.commit()
    db.refresh(composant)
    return composant


def obtenir_composants_session(db: Session, session_id: int):
    """
    Récupère tous les composants détectés pour une session donnée.
    """
    return db.query(models.ComposantDetecte).filter(
        models.ComposantDetecte.session_id == session_id
    ).all()


def mettre_a_jour_etat_composant(db: Session, composant_id: int, nouvel_etat: str):
    """
    Met à jour l'état d'un composant (normal / defectueux / inconnu).
    """
    composant = db.query(models.ComposantDetecte).filter(
        models.ComposantDetecte.id == composant_id
    ).first()
    if composant:
        composant.etat = nouvel_etat
        db.commit()
        db.refresh(composant)
    return composant


# ===============================================================
# ÉTAPES DE RÉPARATION
# ===============================================================

def ajouter_etape(db: Session, session_id: int, numero: int,
                  instruction: str, composant_id: int = None):
    """
    Ajoute une étape de réparation générée par Muse Spark.
    """
    etape = models.EtapeReparation(
        session_id=session_id,
        numero=numero,
        instruction=instruction,
        composant_id=composant_id,
        est_complete="non"
    )
    db.add(etape)
    db.commit()
    db.refresh(etape)
    return etape


def obtenir_etapes_session(db: Session, session_id: int):
    """
    Récupère toutes les étapes d'une session, dans l'ordre.
    """
    return db.query(models.EtapeReparation).filter(
        models.EtapeReparation.session_id == session_id
    ).order_by(models.EtapeReparation.numero).all()


def marquer_etape_complete(db: Session, etape_id: int):
    """
    Marque une étape comme complétée par l'utilisateur.
    """
    etape = db.query(models.EtapeReparation).filter(
        models.EtapeReparation.id == etape_id
    ).first()
    if etape:
        etape.est_complete = "oui"
        db.commit()
        db.refresh(etape)
    return etape


# ===============================================================
# MÉMOIRE CONVERSATIONNELLE LONGUE DURÉE (MESSAGES & PROFIL IA)
# ===============================================================

def ajouter_message(db: Session, session_id: int, auteur: str, texte: str):
    """
    Enregistre un message de discussion (utilisateur ou Muse Spark) dans PostgreSQL
    pour pouvoir reprendre la conversation même plusieurs jours plus tard.
    """
    msg = models.MessageSession(
        session_id=session_id,
        auteur=auteur,
        texte=texte
    )
    db.add(msg)
    db.commit()
    db.refresh(msg)
    return msg


def obtenir_messages_session(db: Session, session_id: int):
    """
    Récupère tout l'historique des messages d'une session dans l'ordre chronologique.
    """
    return db.query(models.MessageSession).filter(
        models.MessageSession.session_id == session_id
    ).order_by(models.MessageSession.id.asc()).all()


def obtenir_memoire_utilisateur(db: Session, utilisateur_id: str, exclure_session_id: int = None):
    """
    Récupère la mémoire inter-sessions d'un utilisateur :
    - Son prénom s'il l'a déjà donné dans une session précédente
    - Ses appareils précédemment réparés ou inspectés
    """
    if not utilisateur_id:
        return {"nom_utilisateur": None, "anciens_appareils": []}

    sessions = obtenir_toutes_sessions(db, utilisateur_id=utilisateur_id, limite=20)
    nom_trouve = None
    anciens_appareils = []

    for s in sessions:
        if s.nom_utilisateur and not nom_trouve:
            nom_trouve = s.nom_utilisateur
        if exclure_session_id and s.id == exclure_session_id:
            continue
        if s.type_appareil and s.type_appareil not in anciens_appareils:
            anciens_appareils.append(s.type_appareil)

    return {
        "nom_utilisateur": nom_trouve,
        "anciens_appareils": anciens_appareils[:5]
    }
