from pydantic import BaseModel, Field
from typing import Optional


class ImageAnalyseRequest(BaseModel):
    image_base64: str = Field(..., min_length=10, max_length=10_000_000)
    langue: str = Field(default="fr", pattern="^(fr|en)$")
    nom_utilisateur: Optional[str] = Field(default=None, max_length=100)
    type_media: str = Field(default="photo", pattern="^(photo|video)$")
    appareil_existant: Optional[str] = Field(default=None, max_length=200)
    historique_messages: Optional[list] = None


class SegmenterRequest(BaseModel):
    session_id: Optional[int] = None
    image_base64: str = Field(..., min_length=10, max_length=10_000_000)
    type_appareil: str = Field(default="appareil inconnu", max_length=200)


class SegmenterPointRequest(BaseModel):
    session_id: int
    image_base64: str = Field(default="", min_length=0, max_length=10_000_000)
    point_x: float = Field(default=50.0, ge=0, le=100)
    point_y: float = Field(default=50.0, ge=0, le=100)
    type_appareil: str = Field(default="appareil", max_length=200)


class VideoAnalyseRequest(BaseModel):
    session_id: Optional[int] = None
    frames_base64: list = Field(..., min_length=1, max_length=10)
    type_appareil: str = Field(default="appareil", max_length=200)


class EvaluerRequest(BaseModel):
    session_id: int
    type_appareil: str = Field(default="appareil inconnu", max_length=200)
    probleme_decrit: str = Field(default="", max_length=2000)
    composants: list = Field(default=[], max_length=20)
    langue: str = Field(default="fr", pattern="^(fr|en)$")
    image_base64: Optional[str] = Field(default=None, max_length=10_000_000)


class DiagnosticFinalRequest(BaseModel):
    session_id: int
    type_appareil: str = Field(default="appareil inconnu", max_length=200)
    probleme_decrit: str = Field(default="", max_length=2000)
    composants: list = Field(default=[], max_length=20)
    reponses: dict = Field(...)
    langue: str = Field(default="fr", pattern="^(fr|en)$")
    image_base64: Optional[str] = Field(default=None, max_length=10_000_000)


class ContinuerRequest(BaseModel):
    session_id: Optional[int] = None
    type_appareil: str = Field(default="appareil", max_length=200)
    probleme_decrit: str = Field(default="")
    composants: list = Field(default=[])
    historique_messages: list = Field(default=[])
    message_technicien: str = Field(..., min_length=1)
    nom_utilisateur: Optional[str] = None
    utilisateur_id: Optional[str] = None
    langue: str = Field(default="fr", pattern="^(fr|en)$")


class NouvelleSessionRequest(BaseModel):
    type_appareil: str = Field(..., min_length=1, max_length=200)
    marque: Optional[str] = None
    probleme_detecte: Optional[str] = None
    utilisateur_id: Optional[str] = None
    nom_utilisateur: Optional[str] = None
    image_miniature: Optional[str] = None


class VerifierEtapeRequest(BaseModel):
    etape_id: Optional[int] = None
    type_appareil: str = Field(default="appareil", max_length=200)
    numero_etape: int = Field(default=1, ge=1)
    instruction_etape: str = Field(default="", max_length=2000)
    image_apres_base64: str = Field(default="", max_length=10_000_000)


class AppelVideoLiveRequest(BaseModel):
    session_id: Optional[int] = None
    type_appareil: str = Field(default="Appareil", max_length=200)
    etape_actuelle: str = Field(default="Inspection visuelle", max_length=500)
    numero_etape: int = Field(default=1, ge=1)
    parole_utilisateur: str = Field(default="", max_length=2000)
    nom_utilisateur: Optional[str] = Field(default=None, max_length=100)
    langue: str = Field(default="fr", pattern="^(fr|en)$")
    tick_index: int = Field(default=0, ge=0)
    frame_base64: Optional[str] = Field(default=None, max_length=10_000_000)
    objets_detectes_vision: list = Field(default=[], max_length=20)


class GuideVisuelRequest(BaseModel):
    nom_composant: str = Field(default="Composant", max_length=200)
    type_appareil: str = Field(default="Appareil", max_length=200)
    nom_utilisateur: Optional[str] = Field(default=None, max_length=100)
    langue: str = Field(default="fr", pattern="^(fr|en)$")


class GenererDiagnosticRequest(BaseModel):
    session_id: int
    probleme_decrit: str = Field(default="Probleme non specifie", max_length=2000)
    type_appareil: str = Field(default="appareil inconnu", max_length=200)


class CameraFrameRequest(BaseModel):
    frame: str = Field(..., min_length=10, max_length=10_000_000)


class ModifierEtatRequest(BaseModel):
    etat: str = Field(..., pattern="^(detecte|suspect_ia|confirme_user|normal|inconnu|defectueux)$")
