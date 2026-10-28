# =============================================================
# models.py — Modèles / Tables de la base de données
# Rôle : Définir la structure exacte des tables PostgreSQL
# =============================================================

from sqlalchemy import Column, Integer, String, Float, DateTime, ForeignKey, Text, Enum
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
import enum
from .database import Base


# ---------------------------------------------------------------
# Enumération : état d'un composant détecté
# ---------------------------------------------------------------
class EtatComposant(str, enum.Enum):
    # Niveau 1 : AI Vision a détecté le composant, état inconnu
    DETECTE         = "detecte"
    # Niveau 2 : Muse Spark suppose que ce composant est défectueux
    SUSPECT_IA      = "suspect_ia"
    # Niveau 3 : L'utilisateur confirme que le composant est défectueux
    CONFIRME_USER   = "confirme_user"
    # Niveau 4 : L'utilisateur confirme que le composant est normal
    NORMAL          = "normal"
    # Par défaut : statut inconnu
    INCONNU         = "inconnu"


# ---------------------------------------------------------------
# Enumération : statut d'une session de réparation
# ---------------------------------------------------------------
class StatutSession(str, enum.Enum):
    EN_COURS = "en_cours"
    RESOLU   = "resolu"
    ABANDONNE = "abandonne"


# ---------------------------------------------------------------
# TABLE 1 : sessions_reparation
# Une session = une tentative de réparation d'un appareil
# ---------------------------------------------------------------
class SessionReparation(Base):
    __tablename__ = "sessions_reparation"

    id                = Column(Integer, primary_key=True, index=True)
    date_creation     = Column(DateTime(timezone=True), server_default=func.now())
    date_modification = Column(DateTime(timezone=True), onupdate=func.now())

    type_appareil     = Column(String(200), nullable=False)   # Ex: "machine à laver", "moteur"
    marque            = Column(String(100), nullable=True)    # Ex: "Samsung", "Bosch"
    probleme_detecte  = Column(Text, nullable=True)           # Description du problème
    diagnostic_ia     = Column(Text, nullable=True)           # Réponse de Muse Spark
    statut            = Column(String(50), default=StatutSession.EN_COURS)
    utilisateur_id    = Column(String(100), nullable=True, index=True)  # Identifiant propre à chaque utilisateur
    nom_utilisateur   = Column(String(100), nullable=True)              # Prénom détecté ou renseigné par l'utilisateur
    image_miniature   = Column(Text, nullable=True)                     # Photo miniature de la session (Base64)

    # Relation : une session contient plusieurs composants, étapes et messages de discussion
    composants = relationship("ComposantDetecte", back_populates="session", cascade="all, delete-orphan")
    etapes     = relationship("EtapeReparation",  back_populates="session", cascade="all, delete-orphan")
    messages   = relationship("MessageSession",   back_populates="session", cascade="all, delete-orphan")

    def __repr__(self):
        return f"<Session id={self.id} appareil='{self.type_appareil}' statut='{self.statut}'>"


# ---------------------------------------------------------------
# TABLE 2 : composants_detectes
# Un composant = une pièce détectée par AI Vision dans une image
# ---------------------------------------------------------------
class ComposantDetecte(Base):
    __tablename__ = "composants_detectes"

    id          = Column(Integer, primary_key=True, index=True)
    session_id  = Column(Integer, ForeignKey("sessions_reparation.id"), nullable=False)

    nom         = Column(String(200), nullable=False)   # Ex: "vis M3", "câble rouge", "condensateur"
    description = Column(Text, nullable=True)           # Description détaillée du composant

    # Position spatiale dans l'image (en pixels) — Expertise BDA / Indexation spatiale
    pos_x       = Column(Float, nullable=True)   # Coordonnée X du centre
    pos_y       = Column(Float, nullable=True)   # Coordonnée Y du centre
    largeur     = Column(Float, nullable=True)   # Largeur du masque
    hauteur     = Column(Float, nullable=True)   # Hauteur du masque
    confiance   = Column(Float, nullable=True)   # Score de confiance AI Vision (0 à 1)

    etat        = Column(String(50), default=EtatComposant.INCONNU)  # normal / defectueux / inconnu
    date_detect = Column(DateTime(timezone=True), server_default=func.now())

    # Relation vers la session parente
    session = relationship("SessionReparation", back_populates="composants")

    def __repr__(self):
        return f"<Composant id={self.id} nom='{self.nom}' etat='{self.etat}'>"


# ---------------------------------------------------------------
# TABLE 3 : etapes_reparation
# Une étape = une instruction générée par Muse Spark
# ---------------------------------------------------------------
class EtapeReparation(Base):
    __tablename__ = "etapes_reparation"

    id           = Column(Integer, primary_key=True, index=True)
    session_id   = Column(Integer, ForeignKey("sessions_reparation.id"), nullable=False)

    numero       = Column(Integer, nullable=False)          # Numéro de l'étape (1, 2, 3...)
    instruction  = Column(Text, nullable=False)             # Texte de l'instruction
    composant_id = Column(Integer, ForeignKey("composants_detectes.id"), nullable=True)  # Pièce concernée
    est_complete = Column(String(10), default="non")        # oui / non
    date_creation = Column(DateTime(timezone=True), server_default=func.now())

    # Relations
    session    = relationship("SessionReparation", back_populates="etapes")

    def __repr__(self):
        return f"<Etape {self.numero}: '{self.instruction[:50]}...'>"


# ---------------------------------------------------------------
# TABLE 4 : messages_session
# Mémoire conversationnelle longue durée (multi-jours) avec Muse Spark
# ---------------------------------------------------------------
class MessageSession(Base):
    __tablename__ = "messages_session"

    id            = Column(Integer, primary_key=True, index=True)
    session_id    = Column(Integer, ForeignKey("sessions_reparation.id"), nullable=False)
    auteur        = Column(String(50), nullable=False)   # "Technicien" ou "Muse Spark"
    texte         = Column(Text, nullable=False)         # Contenu du message
    date_creation = Column(DateTime(timezone=True), server_default=func.now())

    session = relationship("SessionReparation", back_populates="messages")

    def __repr__(self):
        return f"<Message id={self.id} auteur='{self.auteur}'>"
