# =============================================================
# routes/segmentation.py — Routes de segmentation et detection vision
# Role : Envoyer l'image a l'IA vision et retourner les composants detectes
# =============================================================

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

from backend.database.database import get_db
from backend.database import crud
from backend.schemas import (
    ImageAnalyseRequest, SegmenterRequest, SegmenterPointRequest,
    VideoAnalyseRequest, ModifierEtatRequest,
    DetourerRequest, AnalyserVueRequest
)
from backend.services.sam_service import (
    segmenter_image,
    segmenter_point_precis,
    segmenter_video_frames,
    identifier_appareil_et_probleme_sur_image,
    detourer_appareil,
    analyser_vue
)

router = APIRouter()


@router.post("/identifier-image")
async def identifier_image_auto(donnees: ImageAnalyseRequest):
    """
    Identifie automatiquement le nom de l'appareil, sa marque et le problème visible
    dès que l'utilisateur charge une photo ou une vidéo, et lui parle par son prénom.
    """
    resultat = await identifier_appareil_et_probleme_sur_image(
        donnees.image_base64,
        langue=donnees.langue,
        nom_utilisateur=donnees.nom_utilisateur,
        type_media=donnees.type_media,
        appareil_existant=donnees.appareil_existant,
        historique_messages=donnees.historique_messages
    )
    return JSONResponse(content={"statut": "succes", **resultat})


# ---------------------------------------------------------------
# Route 1 : Tester que la route segmentation fonctionne
# ---------------------------------------------------------------
@router.get("/test")
def tester_segmentation():
    return {"message": "Route segmentation operationnelle"}


# ---------------------------------------------------------------
# Route 2 : Segmenter une image et sauvegarder les composants
# C'est le coeur du projet : AI Vision detecte les pieces
# ---------------------------------------------------------------
@router.post("/analyser")
async def analyser_image(donnees: SegmenterRequest, db: Session = Depends(get_db)):
    """
    Recoit une image en base64 et l'ID de session.
    Envoie l'image a l'IA vision pour detecter les composants.
    Sauvegarde les composants detectes dans PostgreSQL.
    """
    session_id   = donnees.session_id
    image_base64 = donnees.image_base64
    type_appareil = donnees.type_appareil

    # Si pas de session, en creer une nouvelle
    if not session_id:
        nouvelle_session = crud.creer_session(db, type_appareil=type_appareil)
        session_id = nouvelle_session.id

    try:
        resultat_seg = await segmenter_image(image_base64, type_appareil)
    except Exception as e:
        raise HTTPException(
            status_code=503,
            detail=f"Erreur lors de l'analyse vision : {str(e)}"
        )

    composants_detectes = resultat_seg.get("composants", [])
    mode_analyse = resultat_seg.get("mode", "ia")

    composants_sauvegardes = []
    for composant in composants_detectes:
        nouveau = crud.ajouter_composant(
            db=db,
            session_id=session_id,
            nom=composant.get("nom", "composant"),
            pos_x=composant.get("pos_x", 0.0),
            pos_y=composant.get("pos_y", 0.0),
            largeur=composant.get("largeur", 0.0),
            hauteur=composant.get("hauteur", 0.0),
            confiance=composant.get("confiance", 0.0),
            etat=composant.get("etat", "inconnu"),
            description=composant.get("description", "")
        )
        composants_sauvegardes.append({
            "id": nouveau.id,
            "nom": nouveau.nom,
            "pos_x": nouveau.pos_x,
            "pos_y": nouveau.pos_y,
            "largeur": nouveau.largeur,
            "hauteur": nouveau.hauteur,
            "confiance": nouveau.confiance,
            "etat": nouveau.etat,
            "description": nouveau.description or composant.get("description", "")
        })

    return JSONResponse(content={
        "statut": "succes",
        "session_id": session_id,
        "mode": mode_analyse,
        "nombre_composants": len(composants_sauvegardes),
        "composants": composants_sauvegardes
    })


# ---------------------------------------------------------------
# Route 3 : Recuperer les composants deja detectes d'une session
# ---------------------------------------------------------------
@router.get("/composants/{session_id}")
def obtenir_composants(session_id: int, db: Session = Depends(get_db)):
    """
    Retourne tous les composants detectes pour une session donnee.
    """
    composants = crud.obtenir_composants_session(db, session_id)

    if not composants:
        raise HTTPException(
            status_code=404,
            detail=f"Aucun composant trouve pour la session {session_id}"
        )

    return JSONResponse(content={
        "session_id": session_id,
        "nombre_composants": len(composants),
        "composants": [
            {
                "id": c.id,
                "nom": c.nom,
                "pos_x": c.pos_x,
                "pos_y": c.pos_y,
                "largeur": c.largeur,
                "hauteur": c.hauteur,
                "etat": c.etat,
                "confiance": c.confiance
            }
            for c in composants
        ]
    })


# ---------------------------------------------------------------
# Route 4 : Confirmer ou modifier l'etat d'un composant (Technicien)
# Permet de passer de "suspect_ia" a "confirme_user" ou "normal"
# ---------------------------------------------------------------
@router.put("/composant/{composant_id}/etat")
def modifier_etat_composant(composant_id: int, donnees: ModifierEtatRequest, db: Session = Depends(get_db)):
    """
    Permet au technicien de confirmer ou corriger l'etat d'un composant.
    """
    nouvel_etat = donnees.etat

    composant = crud.mettre_a_jour_etat_composant(db, composant_id, nouvel_etat)
    if not composant:
        raise HTTPException(status_code=404, detail=f"Composant {composant_id} introuvable.")

    return JSONResponse(content={
        "statut": "succes",
        "composant_id": composant.id,
        "nom": composant.nom,
        "etat": composant.etat
    })


# ---------------------------------------------------------------
# Route 5 : Point-to-Segment AI Vision (Clic precis sur l'image)
# Le technicien touche (x, y) sur la photo pour decouper une piece
# ---------------------------------------------------------------
@router.post("/segmenter-point")
async def segmenter_au_point(donnees: SegmenterPointRequest, db: Session = Depends(get_db)):
    """
    Recoit (point_x, point_y) en % ou le technicien a clique sur la photo.
    L'IA isole la piece exacte sous son doigt et l'ajoute a PostgreSQL.
    """
    session_id    = donnees.session_id
    image_base64  = donnees.image_base64
    point_x       = donnees.point_x
    point_y       = donnees.point_y
    type_appareil = donnees.type_appareil

    comp = await segmenter_point_precis(image_base64, point_x, point_y, type_appareil)

    nouveau = crud.ajouter_composant(
        db=db,
        session_id=session_id,
        nom=comp["nom"],
        pos_x=comp["pos_x"],
        pos_y=comp["pos_y"],
        largeur=comp["largeur"],
        hauteur=comp["hauteur"],
        confiance=comp["confiance"],
        etat=comp["etat"],
        description=comp["description"]
    )

    return JSONResponse(content={
        "statut": "succes",
        "composant": {
            "id": nouveau.id,
            "nom": nouveau.nom,
            "pos_x": nouveau.pos_x,
            "pos_y": nouveau.pos_y,
            "largeur": nouveau.largeur,
            "hauteur": nouveau.hauteur,
            "confiance": nouveau.confiance,
            "etat": nouveau.etat,
            "description": nouveau.description
        }
    })


# ---------------------------------------------------------------
# Route 6 : Analyse de VIDEO avec AI Vision Video Tracking
# Analyse plusieurs frames d'une video (mouvement / clignotements)
# ---------------------------------------------------------------
@router.post("/analyser-video")
async def analyser_video(donnees: VideoAnalyseRequest, db: Session = Depends(get_db)):
    """
    Recoit une liste de frames Base64 extraites d'une video.
    L'IA analyse les pieces dans le temps et sauvegarde les composants dans PostgreSQL.
    """
    session_id    = donnees.session_id
    frames_base64 = donnees.frames_base64
    type_appareil = donnees.type_appareil

    if not frames_base64:
        raise HTTPException(status_code=400, detail="Aucune frame video fournie.")

    if not session_id:
        nouvelle_s = crud.creer_session(db, type_appareil=type_appareil)
        session_id = nouvelle_s.id

    resultat_video = await segmenter_video_frames(frames_base64, type_appareil)

    composants_sauvegardes = []
    for c in resultat_video["composants"]:
        nouveau = crud.ajouter_composant(
            db=db,
            session_id=session_id,
            nom=c["nom"],
            pos_x=c["pos_x"],
            pos_y=c["pos_y"],
            largeur=c["largeur"],
            hauteur=c["hauteur"],
            confiance=c["confiance"],
            etat=c["etat"],
            description=c["description"]
        )
        composants_sauvegardes.append({
            "id": nouveau.id,
            "nom": nouveau.nom,
            "pos_x": nouveau.pos_x,
            "pos_y": nouveau.pos_y,
            "largeur": nouveau.largeur,
            "hauteur": nouveau.hauteur,
            "confiance": nouveau.confiance,
            "etat": nouveau.etat,
            "description": nouveau.description
        })

    return JSONResponse(content={
        "statut": "succes",
        "session_id": session_id,
        "nombre_frames_analysees": resultat_video["nombre_frames_analysees"],
        "resume_mouvement": resultat_video["resume_mouvement"],
        "composants": composants_sauvegardes
    })


# ---------------------------------------------------------------
# Route 7 : Detourer l'appareil (fond transparent via SAM 2)
# ---------------------------------------------------------------
@router.post("/detourer")
async def detourer_image(donnees: DetourerRequest):
    try:
        resultat = await detourer_appareil(donnees.image_base64)
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"Erreur detourage SAM 2 : {str(e)}")

    if resultat.get("erreur"):
        raise HTTPException(status_code=503, detail=resultat["erreur"])

    return JSONResponse(content={
        "statut": "succes",
        "masque_base64": resultat["masque_base64"],
        "temps_ms": resultat["temps_ms"]
    })


# ---------------------------------------------------------------
# Route 8 : Analyser une vue pour detecter de nouveaux defauts
# ---------------------------------------------------------------
@router.post("/analyser-vue")
async def analyser_vue_route(donnees: AnalyserVueRequest):
    try:
        resultat = await analyser_vue(
            donnees.image_base64,
            donnees.type_appareil,
            donnees.angle_label,
            [d.model_dump() for d in donnees.defauts_existants],
            donnees.langue
        )
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"Erreur analyse vue : {str(e)}")

    return JSONResponse(content={
        "statut": "succes",
        "defauts": resultat.get("defauts", []),
        "skip": resultat.get("skip", False)
    })
