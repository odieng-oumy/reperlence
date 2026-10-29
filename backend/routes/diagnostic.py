# =============================================================
# routes/diagnostic.py — Routes de diagnostic avec Muse Spark
# Role : Analyser les composants detectes et generer le guide
# =============================================================

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

from backend.database.database import get_db
from backend.database import crud
from backend.schemas import (
    EvaluerRequest, DiagnosticFinalRequest, ContinuerRequest,
    VerifierEtapeRequest, AppelVideoLiveRequest, GuideVisuelRequest,
    GenererDiagnosticRequest, MicroActionsRequest
)
from backend.services.muse_service import (
    generer_diagnostic,
    evaluer_besoin_infos,
    generer_diagnostic_avec_reponses,
    continuer_conversation_ia,
    verifier_etape_visuelle,
    extraire_prenom_message,
    decrire_visuellement_composant_debutant,
    decomposer_etape,
    analyser_frame_appel_live
)

router = APIRouter()


# ---------------------------------------------------------------
# Route 1 : Tester que la route diagnostic fonctionne
# ---------------------------------------------------------------
@router.get("/test")
def tester_diagnostic():
    return {"message": "Route diagnostic operationnelle"}


# ---------------------------------------------------------------
# Route 2 : Generer un diagnostic complet avec Muse Spark
# Muse Spark analyse les composants et cree les etapes de reparation
# ---------------------------------------------------------------
@router.post("/generer")
async def generer(donnees: GenererDiagnosticRequest, db: Session = Depends(get_db)):
    """
    Recoit un session_id et une description du probleme.
    Recupere les composants detectes depuis PostgreSQL.
    Envoie tout a Muse Spark pour analyse.
    Sauvegarde les etapes de reparation generees.
    Retourne le diagnostic complet et les etapes.
    """
    session_id    = donnees.session_id
    probleme      = donnees.probleme_decrit
    type_appareil = donnees.type_appareil

    # Recuperer les composants detectes depuis la base de donnees
    composants = crud.obtenir_composants_session(db, session_id)
    liste_composants = [
        {"nom": c.nom, "etat": c.etat, "position": f"({c.pos_x}, {c.pos_y})"}
        for c in composants
    ]

    # Appeler Muse Spark pour generer le diagnostic
    try:
        resultat = await generer_diagnostic(
            type_appareil=type_appareil,
            probleme=probleme,
            composants=liste_composants
        )
    except Exception as e:
        raise HTTPException(
            status_code=503,
            detail=f"Erreur Muse Spark : {str(e)}"
        )

    # Sauvegarder le diagnostic dans la session
    crud.mettre_a_jour_session(
        db=db,
        session_id=session_id,
        diagnostic=resultat["diagnostic"],
        statut="en_cours"
    )

    # Sauvegarder chaque etape de reparation dans PostgreSQL
    etapes_sauvegardees = []
    for i, instruction in enumerate(resultat["etapes"], start=1):
        etape = crud.ajouter_etape(
            db=db,
            session_id=session_id,
            numero=i,
            instruction=instruction
        )
        etapes_sauvegardees.append({
            "id": etape.id,
            "numero": etape.numero,
            "instruction": etape.instruction,
            "est_complete": etape.est_complete
        })

    return JSONResponse(content={
        "statut": "succes",
        "session_id": session_id,
        "diagnostic": resultat["diagnostic"],
        "nombre_etapes": len(etapes_sauvegardees),
        "etapes": etapes_sauvegardees
    })


# ---------------------------------------------------------------
# Route 3 : Marquer une etape comme completee
# L'utilisateur coche une etape quand il l'a effectuee
# ---------------------------------------------------------------
@router.put("/etape/{etape_id}/complete")
def completer_etape(etape_id: int, db: Session = Depends(get_db)):
    """
    Marque une etape de reparation comme completee.
    """
    etape = crud.marquer_etape_complete(db, etape_id)

    if not etape:
        raise HTTPException(status_code=404, detail=f"Etape {etape_id} introuvable.")

    return JSONResponse(content={
        "statut": "succes",
        "message": f"Etape {etape.numero} marquee comme completee",
        "etape_id": etape.id
    })


# ---------------------------------------------------------------
# Route 4 : Evaluer si l'IA a besoin de plus d'informations
# NOUVEAU : L'IA demande des questions si le probleme est vague
# ---------------------------------------------------------------
@router.post("/evaluer")
async def evaluer(donnees: EvaluerRequest, db: Session = Depends(get_db)):
    """
    ETAPE 1 : L'IA analyse le probleme et les composants detectes.
    Si elle manque d'infos, elle retourne des questions.
    Sinon, elle retourne directement le diagnostic.
    """
    session_id    = donnees.session_id
    type_appareil = donnees.type_appareil
    probleme      = donnees.probleme_decrit
    composants    = donnees.composants
    langue        = donnees.langue
    image_b64     = donnees.image_base64

    crud.mettre_a_jour_session(db=db, session_id=session_id, probleme_detecte=probleme)

    resultat = await evaluer_besoin_infos(type_appareil, probleme, composants, langue=langue, image_base64=image_b64)

    if resultat.get("besoin_infos"):
        # L'IA a besoin de plus d'infos -> retourner les questions
        return JSONResponse(content={
            "statut": "questions_requises",
            "session_id": session_id,
            "besoin_infos": True,
            "questions": resultat.get("questions", [])
        })
    else:
        # L'IA a assez d'infos -> sauvegarder et retourner le diagnostic
        crud.mettre_a_jour_session(
            db=db, session_id=session_id,
            diagnostic=resultat.get("diagnostic", ""),
            statut="en_cours"
        )
        etapes_sauvegardees = []
        for i, instruction in enumerate(resultat.get("etapes", []), start=1):
            etape = crud.ajouter_etape(db=db, session_id=session_id, numero=i, instruction=instruction)
            etapes_sauvegardees.append({
                "id": etape.id, "numero": etape.numero,
                "instruction": etape.instruction, "est_complete": etape.est_complete
            })
        return JSONResponse(content={
            "statut": "succes",
            "session_id": session_id,
            "besoin_infos": False,
            "diagnostic": resultat.get("diagnostic", ""),
            "meta_reparation": resultat.get("meta_reparation", {}),
            "nombre_etapes": len(etapes_sauvegardees),
            "etapes": etapes_sauvegardees
        })


# ---------------------------------------------------------------
# Route 5 : Diagnostic final avec les reponses du technicien
# NOUVEAU : Le technicien repond aux questions et l'IA diagnostique
# ---------------------------------------------------------------
@router.post("/diagnostic-final")
async def diagnostic_final(donnees: DiagnosticFinalRequest, db: Session = Depends(get_db)):
    """
    ETAPE 2 : Le technicien a repondu aux questions de l'IA.
    L'IA genere le diagnostic final avec ces informations.
    """
    session_id          = donnees.session_id
    type_appareil       = donnees.type_appareil
    probleme            = donnees.probleme_decrit
    composants          = donnees.composants
    reponses_technicien = donnees.reponses
    langue              = donnees.langue
    image_b64           = donnees.image_base64

    resultat = await generer_diagnostic_avec_reponses(
        type_appareil=type_appareil,
        probleme=probleme,
        composants=composants,
        reponses_technicien=reponses_technicien,
        langue=langue,
        image_base64=image_b64
    )

    # Sauvegarder le diagnostic dans la base de donnees
    crud.mettre_a_jour_session(
        db=db, session_id=session_id,
        diagnostic=resultat.get("diagnostic", ""),
        statut="en_cours"
    )

    # Sauvegarder les etapes
    etapes_sauvegardees = []
    for i, instruction in enumerate(resultat.get("etapes", []), start=1):
        etape = crud.ajouter_etape(db=db, session_id=session_id, numero=i, instruction=instruction)
        etapes_sauvegardees.append({
            "id": etape.id, "numero": etape.numero,
            "instruction": etape.instruction, "est_complete": etape.est_complete
        })

    return JSONResponse(content={
        "statut": "succes",
        "session_id": session_id,
        "diagnostic": resultat.get("diagnostic", ""),
        "meta_reparation": resultat.get("meta_reparation", {}),
        "nombre_etapes": len(etapes_sauvegardees),
        "etapes": etapes_sauvegardees
    })


# ---------------------------------------------------------------
# Route 6 : Continuer la conversation avec l'IA (Probleme non resolu)
# NOUVEAU : Le technicien discute avec Muse Spark jusqu'a la resolution
# ---------------------------------------------------------------
@router.post("/continuer")
async def continuer_discussion(donnees: ContinuerRequest, db: Session = Depends(get_db)):
    """
    ETAPE 3 (Boucle continue) :
    Le technicien explique ce qu'il a observe ou teste, et l'IA
    continue de le guider et ajoute de nouvelles etapes si besoin.
    """
    session_id          = donnees.session_id
    type_appareil       = donnees.type_appareil
    probleme            = donnees.probleme_decrit
    composants          = donnees.composants
    historique_messages = donnees.historique_messages
    message_technicien  = donnees.message_technicien
    nom_utilisateur     = donnees.nom_utilisateur
    utilisateur_id      = donnees.utilisateur_id
    langue              = donnees.langue

    # Si la discussion démarre sur l'écran d'accueil sans session préalable, on crée la session automatiquement
    if not session_id:
        session_obj = crud.creer_session(
            db=db,
            type_appareil=type_appareil or "Appareil",
            probleme_detecte=probleme or message_technicien,
            utilisateur_id=utilisateur_id,
            nom_utilisateur=nom_utilisateur
        )
        session_id = session_obj.id
    else:
        session_obj = crud.obtenir_session(db, session_id)

    # Recuperer la memoire inter-sessions de l'utilisateur depuis PostgreSQL
    uid = utilisateur_id or (session_obj.utilisateur_id if session_obj else None)
    memoire = crud.obtenir_memoire_utilisateur(db, uid, exclure_session_id=session_id)
    prenom_connu = nom_utilisateur or (session_obj.nom_utilisateur if session_obj else None) or memoire.get("nom_utilisateur")
    anciens = memoire.get("anciens_appareils", [])

    # Si le type_appareil envoyé est générique ("Appareil", "Appareil électronique"), restaurer le nom précis mémorisé
    appareils_generiques = ["Appareil", "Appareil électronique", "Electronic Device", "appareil", ""]
    if type_appareil in appareils_generiques:
        if session_obj and session_obj.type_appareil and session_obj.type_appareil not in appareils_generiques:
            type_appareil = session_obj.type_appareil
        elif anciens:
            type_appareil = anciens[0]
            if session_obj:
                crud.mettre_a_jour_session(db, session_id=session_id, type_appareil=type_appareil)

    # Sauvegarder le message de l'utilisateur dans PostgreSQL (memoire multi-jours)
    crud.ajouter_message(db, session_id=session_id, auteur="Technicien", texte=message_technicien)

    resultat = await continuer_conversation_ia(
        type_appareil=type_appareil,
        probleme=probleme,
        composants=composants,
        historique_messages=historique_messages,
        message_technicien=message_technicien,
        nom_utilisateur=prenom_connu,
        anciens_appareils=anciens,
        langue=langue
    )

    # Si l'IA a detecte que l'utilisateur vient de donner son prenom, on le sauvegarde en BDD !
    prenom_detecte = resultat.get("prenom_detecte") or extraire_prenom_message(message_technicien)
    if prenom_detecte:
        crud.mettre_a_jour_session(db, session_id=session_id, nom_utilisateur=prenom_detecte)

    # Sauvegarder la reponse de Muse Spark dans PostgreSQL
    crud.ajouter_message(db, session_id=session_id, auteur="Muse Spark", texte=resultat.get("reponse_ia", ""))

    # Recuperer le nombre d'etapes existantes pour numeroter la suite correctement
    etapes_existantes = crud.obtenir_etapes_session(db, session_id)
    prochain_numero = len(etapes_existantes) + 1

    nouvelles_etapes_sauvegardees = []
    for i, instruction in enumerate(resultat.get("nouvelles_etapes", []), start=prochain_numero):
        etape = crud.ajouter_etape(db=db, session_id=session_id, numero=i, instruction=instruction)
        nouvelles_etapes_sauvegardees.append({
            "id": etape.id,
            "numero": etape.numero,
            "instruction": etape.instruction,
            "est_complete": etape.est_complete
        })

    return JSONResponse(content={
        "statut": "succes",
        "session_id": session_id,
        "reponse_ia": resultat.get("reponse_ia", ""),
        "prenom_detecte": prenom_detecte or prenom_connu,
        "proposer_appel_video": bool(resultat.get("proposer_appel_video")),
        "guide_visuel": resultat.get("guide_visuel"),
        "nouvelles_etapes": nouvelles_etapes_sauvegardees
    })


# ---------------------------------------------------------------
# Route 8 : Guide visuel debutant ("A quoi ressemble cette piece ?")
# ---------------------------------------------------------------
@router.post("/guide-visuel-piece")
def obtenir_guide_visuel_piece(donnees: GuideVisuelRequest):
    """
    Explique a un non-technicien a quoi ressemble physiquement une piece
    (forme, couleur, taille, signes visuels de panne et reference d'achat).
    """
    nom_composant   = donnees.nom_composant
    type_appareil   = donnees.type_appareil
    nom_utilisateur = donnees.nom_utilisateur
    langue          = donnees.langue

    guide = decrire_visuellement_composant_debutant(
        nom_composant=nom_composant,
        type_appareil=type_appareil,
        nom_utilisateur=nom_utilisateur,
        langue=langue
    )
    return JSONResponse(content={
        "statut": "succes",
        "guide": guide
    })


# ---------------------------------------------------------------
# Route 9 : Appel Video en Direct avec l'IA (Live Co-Pilot Watch Mode)
# ---------------------------------------------------------------
@router.post("/appel-video-live")
async def appel_video_live(donnees: AppelVideoLiveRequest, db: Session = Depends(get_db)):
    """
    Recoit les frames de la camera en direct + la voix de l'utilisateur
    pendant l'appel video avec l'IA.
    """
    session_id         = donnees.session_id
    type_appareil      = donnees.type_appareil
    etape_actuelle     = donnees.etape_actuelle
    numero_etape       = donnees.numero_etape
    parole_utilisateur = donnees.parole_utilisateur
    nom_utilisateur    = donnees.nom_utilisateur
    langue             = donnees.langue
    tick_index         = donnees.tick_index
    frame_base64       = donnees.frame_base64
    objets_vision      = donnees.objets_detectes_vision

    resultat = await analyser_frame_appel_live(
        type_appareil=type_appareil,
        etape_actuelle=etape_actuelle,
        numero_etape=numero_etape,
        parole_utilisateur=parole_utilisateur,
        nom_utilisateur=nom_utilisateur,
        langue=langue,
        tick_index=tick_index,
        frame_base64=frame_base64,
        objets_detectes_vision=objets_vision
    )

    if session_id and parole_utilisateur:
        crud.ajouter_message(db, session_id=session_id, auteur="Technicien (Live Vidéo)", texte=parole_utilisateur)
        crud.ajouter_message(db, session_id=session_id, auteur="Muse Spark", texte=resultat["reponse_vocale"])
        if resultat.get("prenom_detecte"):
            crud.mettre_a_jour_session(db, session_id=session_id, nom_utilisateur=resultat["prenom_detecte"])

    return JSONResponse(content={
        "statut": "succes",
        **resultat
    })


# ---------------------------------------------------------------
# Route 7 : Verification visuelle Avant / Apres d'une etape
# Le technicien prend en photo son travail pour valider l'etape !
# ---------------------------------------------------------------
@router.post("/verifier-etape")
async def verifier_etape_photo(donnees: VerifierEtapeRequest, db: Session = Depends(get_db)):
    """
    Verifie visuellement si l'etape a bien ete realisee
    et la coche automatiquement dans PostgreSQL.
    """
    etape_id          = donnees.etape_id
    type_appareil     = donnees.type_appareil
    numero_etape      = donnees.numero_etape
    instruction_etape = donnees.instruction_etape
    image_apres       = donnees.image_apres_base64

    resultat = await verifier_etape_visuelle(
        type_appareil=type_appareil,
        numero_etape=numero_etape,
        instruction_etape=instruction_etape,
        image_apres_base64=image_apres
    )

    if resultat.get("valide") and etape_id:
        crud.marquer_etape_complete(db, etape_id)

    return JSONResponse(content={
        "statut": "succes",
        "valide": resultat.get("valide", True),
        "commentaire_ia": resultat.get("commentaire_ia", "")
    })


@router.post("/micro-actions")
async def obtenir_micro_actions(donnees: MicroActionsRequest):
    try:
        resultat = await decomposer_etape(
            donnees.instruction, donnees.type_appareil, donnees.langue
        )
    except Exception as e:
        raise HTTPException(status_code=503, detail=str(e))

    return JSONResponse(content={
        "statut": "succes",
        "micro_actions": resultat.get("micro_actions", "")
    })
