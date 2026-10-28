# =============================================================
# routes/history.py — Routes de gestion de l'historique
# Role : Afficher et gerer les sessions de reparation passees
# =============================================================

from fastapi import APIRouter, Depends, HTTPException, Header
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

from backend.database.database import get_db
from backend.database import crud
from backend.schemas import NouvelleSessionRequest

router = APIRouter()


def _get_utilisateur_id(x_utilisateur_id: str = Header(None)) -> str:
    if not x_utilisateur_id:
        raise HTTPException(status_code=401, detail="Header X-Utilisateur-Id requis.")
    return x_utilisateur_id


def _verifier_proprietaire(session, utilisateur_id: str):
    if not session:
        raise HTTPException(status_code=404, detail="Session introuvable.")
    if session.utilisateur_id and session.utilisateur_id != utilisateur_id:
        raise HTTPException(status_code=403, detail="Acces refuse a cette session.")


@router.get("/")
def obtenir_historique(
    db: Session = Depends(get_db),
    utilisateur_id: str = Depends(_get_utilisateur_id)
):
    sessions = crud.obtenir_toutes_sessions(db, utilisateur_id=utilisateur_id)

    resultat_sessions = []
    for s in sessions:
        etapes = crud.obtenir_etapes_session(db, s.id)
        total_etapes = len(etapes)
        etapes_completes = sum(1 for e in etapes if e.est_complete == "oui")
        resultat_sessions.append({
            "id": s.id,
            "type_appareil": s.type_appareil,
            "marque": s.marque,
            "probleme_detecte": s.probleme_detecte,
            "diagnostic_ia": s.diagnostic_ia,
            "statut": s.statut,
            "utilisateur_id": s.utilisateur_id,
            "image_miniature": s.image_miniature,
            "total_etapes": total_etapes,
            "etapes_completes": etapes_completes,
            "date_creation": str(s.date_creation)
        })

    return JSONResponse(content={
        "statut": "succes",
        "nombre_sessions": len(resultat_sessions),
        "sessions": resultat_sessions
    })


@router.get("/{session_id}")
def obtenir_details_session(
    session_id: int,
    db: Session = Depends(get_db),
    utilisateur_id: str = Depends(_get_utilisateur_id)
):
    session = crud.obtenir_session(db, session_id)
    _verifier_proprietaire(session, utilisateur_id)

    composants = crud.obtenir_composants_session(db, session_id)
    etapes     = crud.obtenir_etapes_session(db, session_id)
    messages   = crud.obtenir_messages_session(db, session_id)
    memoire    = crud.obtenir_memoire_utilisateur(db, session.utilisateur_id, exclure_session_id=session.id)

    nom_user = session.nom_utilisateur or memoire.get("nom_utilisateur") or ""
    salut = f"Bon retour {nom_user} ! " if nom_user else "Bon retour ! "
    nb_faites = sum(1 for e in etapes if e.est_complete == "oui")
    prochaine_etape = next((e for e in etapes if e.est_complete != "oui"), None)

    dernier_msg = messages[-1].texte if len(messages) > 0 else None
    resume_reprise_ia = (
        f"{salut}J'ai garde toute notre memoire sur ton {session.type_appareil}. "
        f"Tu avais valide {nb_faites} etape(s) sur {len(etapes)}. "
        + (f"Prochaine etape a faire ensemble : {prochaine_etape.instruction}. " if prochaine_etape else "")
        + (f"Dernier point dont on parlait : {dernier_msg[:90]}..." if dernier_msg else "On reprend exactement la ou tu t'etais arrete(e) !")
    )

    return JSONResponse(content={
        "session": {
            "id": session.id,
            "type_appareil": session.type_appareil,
            "marque": session.marque,
            "probleme_detecte": session.probleme_detecte,
            "diagnostic_ia": session.diagnostic_ia,
            "statut": session.statut,
            "nom_utilisateur": nom_user,
            "image_miniature": session.image_miniature,
            "date_creation": str(session.date_creation)
        },
        "resume_reprise_ia": resume_reprise_ia,
        "anciens_appareils": memoire.get("anciens_appareils", []),
        "messages": [
            {"id": m.id, "auteur": m.auteur, "texte": m.texte, "date_creation": str(m.date_creation)}
            for m in messages
        ],
        "composants": [
            {"id": c.id, "nom": c.nom, "description": c.description, "pos_x": c.pos_x, "pos_y": c.pos_y,
             "largeur": c.largeur, "hauteur": c.hauteur, "etat": c.etat, "confiance": c.confiance}
            for c in composants
        ],
        "etapes": [
            {"id": e.id, "numero": e.numero, "instruction": e.instruction, "est_complete": e.est_complete}
            for e in etapes
        ]
    })


@router.post("/nouvelle")
def nouvelle_session(donnees: NouvelleSessionRequest, db: Session = Depends(get_db)):
    from backend.services.muse_service import extraire_prenom_message

    type_appareil    = donnees.type_appareil
    marque           = donnees.marque
    probleme_detecte = donnees.probleme_detecte
    utilisateur_id   = donnees.utilisateur_id
    nom_utilisateur  = donnees.nom_utilisateur or extraire_prenom_message(probleme_detecte or "")
    image_miniature  = donnees.image_miniature

    session = crud.creer_session(
        db, type_appareil=type_appareil, marque=marque,
        probleme_detecte=probleme_detecte, utilisateur_id=utilisateur_id,
        nom_utilisateur=nom_utilisateur, image_miniature=image_miniature
    )

    return JSONResponse(content={
        "statut": "succes",
        "message": "Nouvelle session creee",
        "session_id": session.id,
        "type_appareil": session.type_appareil,
        "nom_utilisateur": session.nom_utilisateur
    })


@router.put("/{session_id}/resoudre")
def resoudre_session(
    session_id: int,
    db: Session = Depends(get_db),
    utilisateur_id: str = Depends(_get_utilisateur_id)
):
    session = crud.obtenir_session(db, session_id)
    _verifier_proprietaire(session, utilisateur_id)

    crud.mettre_a_jour_session(db=db, session_id=session_id, statut="resolu")

    return JSONResponse(content={
        "statut": "succes",
        "message": f"Session {session_id} marquee comme resolue"
    })


@router.delete("/{session_id}")
def supprimer_session(
    session_id: int,
    db: Session = Depends(get_db),
    utilisateur_id: str = Depends(_get_utilisateur_id)
):
    session = crud.obtenir_session(db, session_id)
    _verifier_proprietaire(session, utilisateur_id)

    crud.supprimer_session(db, session_id)

    return JSONResponse(content={
        "statut": "succes",
        "message": f"Session {session_id} supprimee avec succes"
    })
