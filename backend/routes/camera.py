# =============================================================
# routes/camera.py — Routes de gestion de la camera
# Role : Recevoir les images/frames du frontend
# =============================================================

from fastapi import APIRouter, UploadFile, File, HTTPException
from fastapi.responses import JSONResponse
import base64
import io
from PIL import Image

from backend.schemas import CameraFrameRequest

router = APIRouter()


# ---------------------------------------------------------------
# Route 1 : Tester que la route camera fonctionne
# ---------------------------------------------------------------
@router.get("/test")
def tester_camera():
    return {"message": "Route camera operationnelle"}


# ---------------------------------------------------------------
# Route 2 : Recevoir une image uploadee par l'utilisateur
# L'utilisateur uploade une photo de la machine a reparer
# ---------------------------------------------------------------
@router.post("/upload")
async def recevoir_image(fichier: UploadFile = File(...)):
    """
    Recoit une image depuis le frontend.
    Verifie que c'est bien une image valide.
    Retourne l'image encodee en base64 pour la segmentation.
    """

    # Verifier que le fichier est bien une image
    types_autorises = ["image/jpeg", "image/png", "image/webp"]
    if fichier.content_type not in types_autorises:
        raise HTTPException(
            status_code=400,
            detail=f"Type de fichier non autorise : {fichier.content_type}. Utilisez JPG, PNG ou WebP."
        )

    # Lire le contenu du fichier
    contenu = await fichier.read()

    # Verifier que l'image est valide avec PIL
    try:
        image = Image.open(io.BytesIO(contenu))
        largeur, hauteur = image.size
    except Exception:
        raise HTTPException(status_code=400, detail="Fichier image invalide ou corrompu.")

    # Encoder l'image en base64 pour l'envoyer a AI Vision
    image_base64 = base64.b64encode(contenu).decode("utf-8")

    return JSONResponse(content={
        "statut": "succes",
        "message": "Image recue avec succes",
        "nom_fichier": fichier.filename,
        "largeur": largeur,
        "hauteur": hauteur,
        "image_base64": image_base64   # Sera envoye a AI Vision pour segmentation
    })


# ---------------------------------------------------------------
# Route 3 : Recevoir une frame video en base64 (flux temps reel)
# Le frontend envoie les frames de la webcam en continu
# ---------------------------------------------------------------
@router.post("/frame")
async def recevoir_frame(donnees: CameraFrameRequest):
    """
    Recoit une frame video encodee en base64 depuis la webcam.
    """
    frame_data = donnees.frame

    # Supprimer le prefixe "data:image/jpeg;base64,"
    if "," in frame_data:
        frame_data = frame_data.split(",")[1]

    # Decoder la frame
    try:
        frame_bytes = base64.b64decode(frame_data)
        image = Image.open(io.BytesIO(frame_bytes))
        largeur, hauteur = image.size
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Frame invalide : {str(e)}")

    return JSONResponse(content={
        "statut": "succes",
        "message": "Frame recue",
        "largeur": largeur,
        "hauteur": hauteur,
        "frame_base64": frame_data    # Prete pour AI Vision
    })
