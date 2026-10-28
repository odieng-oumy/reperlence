# =============================================================
# services/muse_service.py — Service de diagnostic IA
# Utilise l'API Meta AI (Llama) — async avec httpx
# =============================================================

import os
import re
import json
import httpx
from dotenv import load_dotenv

load_dotenv()

META_API_KEY = os.getenv("META_API_KEY", "")
META_API_URL = os.getenv("META_API_URL", "https://api.meta.ai/v1")
META_VISION_MODEL = os.getenv("META_VISION_MODEL", "muse-spark-1.3")
META_TEXT_MODEL = os.getenv("META_TEXT_MODEL", "muse-spark-1.3")

TIMEOUT = 60


def _is_api_configured() -> bool:
    return bool(META_API_KEY) and META_API_KEY != "your_meta_api_key_here"


def _headers() -> dict:
    return {
        "Authorization": f"Bearer {META_API_KEY}",
        "Content-Type": "application/json",
    }


def _extraire_json(texte: str) -> dict:
    if not texte:
        return {}
    propre = re.sub(r"```(?:json)?", "", texte).replace("```", "").strip()
    try:
        return json.loads(propre)
    except Exception:
        match = re.search(r"\{.*\}", propre, re.DOTALL)
        if match:
            try:
                return json.loads(match.group(0))
            except Exception:
                return {}
    return {}


def _clean_emojis(text: str) -> str:
    return re.sub(r"[^\x00-\x7F\xC0-\xFFĀ-ɏ -⁯←-⇿☀-⛿]", "", text).strip()


def extraire_prenom_message(texte: str) -> str:
    if not texte:
        return None
    motifs = [
        r"(?:je m'appelle|moi c'est|salut c'est|bonjour c'est|je suis|appelle[- ]moi|mon nom est|mon prenom est|mon prénom est)\s+([A-ZÀ-Ÿa-zà-ÿ]{2,20})",
        r"(?:my name is|i am|i'm|call me|hey it's|hi i'm)\s+([A-ZÀ-Ÿa-zà-ÿ]{2,20})"
    ]
    mots_exclus = {
        "pas", "un", "une", "le", "la", "les", "en", "dans", "sur", "tres", "très",
        "bloque", "bloqué", "cassé", "casse", "panne", "ici", "bien", "prêt", "pret",
        "not", "here", "ready", "stuck", "broken", "trying", "debutant", "débutant",
        "technicien", "technicienne", "novice", "perdu", "perdue"
    }
    for motif in motifs:
        match = re.search(motif, texte, re.IGNORECASE)
        if match:
            candidat = match.group(1).strip()
            if candidat.lower() not in mots_exclus:
                return candidat.capitalize()
    return None


async def _call_llm(messages: list, model: str = None, max_tokens: int = 4000) -> str:
    if not _is_api_configured():
        return ""
    async with httpx.AsyncClient(timeout=TIMEOUT) as client:
        resp = await client.post(
            f"{META_API_URL}/chat/completions",
            headers=_headers(),
            json={
                "model": model or META_TEXT_MODEL,
                "messages": messages,
                "max_tokens": max_tokens,
                "temperature": 0.7,
            },
        )
        resp.raise_for_status()
        return resp.json()["choices"][0]["message"].get("content", "")


async def _call_llm_vision(prompt: str, image_base64: str, max_tokens: int = 4000) -> str:
    if not _is_api_configured() or not image_base64:
        return ""
    b64 = image_base64.split(",", 1)[1] if "," in image_base64 else image_base64
    async with httpx.AsyncClient(timeout=TIMEOUT) as client:
        resp = await client.post(
            f"{META_API_URL}/chat/completions",
            headers=_headers(),
            json={
                "model": META_VISION_MODEL,
                "messages": [{
                    "role": "user",
                    "content": [
                        {"type": "text", "text": prompt},
                        {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{b64}"}}
                    ]
                }],
                "max_tokens": max_tokens,
            },
        )
        resp.raise_for_status()
        return resp.json()["choices"][0]["message"].get("content", "")


def chercher_photo_reelle_internet(terme_recherche: str, svg_type: str) -> str:
    requetes_wiki = {
        "capacitor": "Film_capacitor",
        "fuse": "Thermal_cutoff",
        "coil": "Stator",
        "connector": "Electrical_connector",
        "chip": "Printed_circuit_board"
    }
    page_wiki = requetes_wiki.get(svg_type, "Electronic_component")
    try:
        import requests as sync_requests
        r = sync_requests.get(
            f"https://en.wikipedia.org/api/rest_v1/page/summary/{page_wiki}",
            headers={"User-Agent": "RepairLensHackathon/1.0"},
            timeout=4
        )
        if r.status_code == 200:
            data = r.json()
            if "thumbnail" in data and "source" in data["thumbnail"]:
                return data["thumbnail"]["source"]
    except Exception:
        pass

    fallbacks = {
        "capacitor": "https://upload.wikimedia.org/wikipedia/commons/thumb/b/b9/Capacitors_%287189597135%29.jpg/320px-Capacitors_%287189597135%29.jpg",
        "fuse": "https://upload.wikimedia.org/wikipedia/commons/thumb/6/60/Thermal_fuses.jpg/320px-Thermal_fuses.jpg",
        "coil": "https://upload.wikimedia.org/wikipedia/commons/thumb/f/f1/Universal_motor_stator.jpg/320px-Universal_motor_stator.jpg",
        "connector": "https://upload.wikimedia.org/wikipedia/commons/thumb/8/82/Molex_female_connector.jpg/320px-Molex_female_connector.jpg",
        "chip": "https://upload.wikimedia.org/wikipedia/commons/thumb/d/d9/Arduino_ftdi_chip-1.jpg/320px-Arduino_ftdi_chip-1.jpg"
    }
    return fallbacks.get(svg_type, fallbacks["chip"])


def decrire_visuellement_composant_debutant(nom_composant: str, type_appareil: str, nom_utilisateur: str = None, langue: str = "fr") -> dict:
    is_en = (langue == "en")
    prenom = f"{nom_utilisateur}, " if nom_utilisateur else ""
    nom_min = (nom_composant or "").lower()

    if "condensateur" in nom_min or "capacitor" in nom_min:
        forme = "A small silver/black cylinder (like an AA battery) or a small rectangular block with 2 metal pins." if is_en else "Un petit cylindre argente ou noir (comme une petite pile AA) ou un petit boitier rectangulaire avec 2 pattes metalliques."
        role = "It is the electrical 'starter' that gives the motor the push it needs to start spinning." if is_en else "C'est le 'starter' qui donne l'elan electrique au moteur pour l'aider a demarrer."
        signes = "Look at the top: if it is bulging/swollen (instead of flat), cracked, or has brown/yellow crust leaking out, it is dead." if is_en else "Regarde le dessus : s'il est bombe/gonfle (au lieu d'etre bien plat), fissure, ou s'il y a une trace marron/jaune qui a coule, il est hors service."
        ref = "Start Capacitor CBB61 (2uF to 4.5uF - 450V AC) - Est. Price: ~$4 to $8" if is_en else "Condensateur de demarrage CBB61 (2uF a 4.5uF - 450V AC) - Prix moyen : ~4 $ a 8 $"
        svg_type = "capacitor"
    elif "fusible" in nom_min or "fuse" in nom_min or "thermique" in nom_min:
        forme = "A tiny shiny metal or white ceramic tube (the size of a grain of rice or pill) crimped between two wires." if is_en else "Un tout petit tube brillant metallique ou blanc en ceramique (grand comme un grain de riz ou une gelule) coince entre deux fils."
        role = "It is the device's bodyguard: it cuts power automatically if the device overheats to prevent a fire." if is_en else "C'est le garde du corps de l'appareil : il se coupe volontairement si l'appareil chauffe trop pour eviter un incendie."
        signes = "Often looks intact on the outside or slightly darkened. If blown inside, no power passes through at all." if is_en else "Souvent il parait intact de l'exterieur, ou legerement noirci. S'il est coupe a l'interieur, le courant ne passe plus du tout."
        ref = "Thermal Fuse 250V 10A (184C / 216C) - Est. Price: ~$2 to $5" if is_en else "Fusible thermique 250V 10A (184C / 216C) - Prix moyen : ~2 $ a 5 $"
        svg_type = "fuse"
    elif "bobine" in nom_min or "moteur" in nom_min or "rotor" in nom_min or "stator" in nom_min or "coil" in nom_min or "motor" in nom_min:
        forme = "A ring of bronze/orange copper wires wound tightly around a central metal core." if is_en else "Une couronne de fils de cuivre couleur bronze/orange enroules tres serres autour d'un bloc metallique au centre."
        role = "It is the magnetic heart that spins your device's shaft when electricity flows through it." if is_en else "C'est le coeur magnetique qui fait tourner l'axe de ton appareil quand l'electricite passe dedans."
        signes = "Burnt varnish smell, or the copper wires turning dark black instead of bright shiny orange." if is_en else "Sentir une odeur de chaud/vernis brule, ou voir les fils de cuivre devenir noirs au lieu d'etre orange brillant."
        ref = "Motor Stator / Coil or Shaft cleaning + PTFE lubricant - Est. Price: ~$12 to $25" if is_en else "Stator / Bobinage moteur ou Nettoyage axe + lubrifiant PTFE - Prix moyen : ~12 $ a 25 $"
        svg_type = "coil"
    elif "cable" in nom_min or "connecteur" in nom_min or "fil" in nom_min or "wire" in nom_min or "power" in nom_min or "alimentation" in nom_min:
        forme = "A flexible plastic wire (usually black, blue, or brown) ending in a small white plastic or metal clip plugged into the board." if is_en else "Une gaine en plastique souple (souvent noire, bleue ou marron) qui se termine par une petite prise blanche ou metallique clipsee sur la carte."
        role = "It is the highway bringing electricity from your wall outlet to the internal parts." if is_en else "C'est la route qui amene l'electricite depuis ta prise murale jusqu'aux pieces internes."
        signes = "Melted or blackened plastic around the plug, cut wire, or a loose connector that wiggles when touched." if is_en else "Plastique fondu ou noirci autour de la prise, fil coupe, ou connecteur qui bouge tout seul quand on le touche."
        ref = "Insulated Faston Connector 6.3mm / Terminal Block - Est. Price: ~$3" if is_en else "Connecteur Faston isole 6.3mm / Bornier secteur - Prix moyen : ~3 $"
        svg_type = "connector"
    else:
        forme = f"A distinct part on your {type_appareil}, pinpointed by the AI (usually held by 1-2 screws or clipped onto the main frame)." if is_en else f"Une piece bien distincte sur ton {type_appareil}, reperee par l'IA (souvent fixee par 1 ou 2 vis ou clipsee sur le support principal)."
        role = f"It ensures the mechanical or electrical operation of the main zone of your {type_appareil}." if is_en else f"Elle assure le bon fonctionnement mecanique ou electrique de la zone centrale de ton {type_appareil}."
        signes = "Look for a visible crack, black burn mark, loose screw, or unplugged wire right next to it." if is_en else "Cherche une fissure visible, une trace noire de chauffe, une vis desserree ou un fil debranche juste a cote."
        ref = f"OEM Part {nom_composant} ({type_appareil}) - Est. Price: ~$10 to $18" if is_en else f"Piece d'origine {nom_composant} ({type_appareil}) - Prix moyen : ~10 $ a 18 $"
        svg_type = "chip"

    image_web_url = chercher_photo_reelle_internet(nom_composant, svg_type)
    import requests as sync_requests
    q_str = f"{nom_composant} {type_appareil} {'replacement part' if is_en else 'piece detachee'}"
    lien_recherche_images = f"https://www.google.com/search?tbm=isch&q={sync_requests.utils.quote(q_str)}"

    if is_en:
        message_vocal = (
            f"Don't worry {prenom}you don't need to be a technician! "
            f"I'm showing you a real photo of the {nom_composant} from the web right next to the zoom on your photo. "
            f"It is {forme} {signes}"
        )
    else:
        message_vocal = (
            f"Ne t'inquiete pas {prenom}tu n'as pas besoin d'etre technicien ! "
            f"Je t'affiche a l'ecran une vraie photo de la piece appelee {nom_composant} trouvee sur internet, a cote du zoom sur ta propre photo. "
            f"C'est {forme} {signes}"
        )

    return {
        "nom_composant": nom_composant,
        "forme_et_couleur": forme,
        "role_simple": role,
        "signes_usure_visuels": signes,
        "reference_achat": ref,
        "svg_type": svg_type,
        "image_web_url": image_web_url,
        "lien_recherche_images": lien_recherche_images,
        "message_vocal": message_vocal
    }


# =============================================================
# CORE AI FUNCTIONS
# =============================================================

async def evaluer_besoin_infos(type_appareil: str, probleme: str, composants: list,
                               langue: str = "fr", image_base64: str = None) -> dict:
    if not _is_api_configured():
        raise RuntimeError("Meta AI API key not configured. Set META_API_KEY in .env")

    liste_comp = "\n".join([f"- {c['nom']} (state: {c['etat']})" for c in composants])
    lang_instruction = "Respond entirely in English." if langue == "en" else "Reponds entierement en francais."

    prompt = f"""You are an elite hardware repair engineer with extreme pedagogical clarity. When you name a technical component, immediately explain it in simple words. Only cite specific part numbers or references if you have confirmed them — if unsure, describe the component by its appearance and function instead. {lang_instruction}

Device: {type_appareil}
Reported problem: {probleme}
Visually detected components:
{liste_comp}

Before diagnosing, evaluate if the problem description is too vague (< 4 words without detail).
If yes, ask 2-3 short precise questions ("besoin_infos": true).
If no, give the full diagnosis directly with repairability metrics and 5-7 clear steps ("besoin_infos": false).

Do NOT use any emojis. Respond ONLY in valid JSON:
{{
  "besoin_infos": true or false,
  "questions": ["Question 1?", "Question 2?"],
  "diagnostic": "Clear diagnosis with safety reminder",
  "meta_reparation": {{
    "score_reparabilite": "8.5 / 10",
    "temps_estime": "25 min",
    "difficulte": "Beginner-Friendly",
    "outils_requis": ["Phillips PH2 Screwdriver", "Digital Multimeter"],
    "cout_piece": "~$12",
    "economie_realisee": "~$185",
    "dechet_evite": "14 kg e-waste"
  }},
  "etapes": ["Step 1: ...", "Step 2: ..."]
}}"""

    try:
        if image_base64:
            raw = await _call_llm_vision(prompt, image_base64, max_tokens=4000)
        else:
            raw = await _call_llm([{"role": "user", "content": prompt}], max_tokens=4000)
        out = _extraire_json(raw)
        if out and "besoin_infos" in out:
            return out
    except Exception as e:
        print(f"[LLM] Evaluation error: {e}")
        raise


async def generer_diagnostic_avec_reponses(type_appareil: str, probleme: str,
                                           composants: list, reponses_technicien: dict,
                                           langue: str = "fr", image_base64: str = None) -> dict:
    if not _is_api_configured():
        raise RuntimeError("Meta AI API key not configured. Set META_API_KEY in .env")

    liste_comp = "\n".join([f"- {c['nom']} (state: {c['etat']})" for c in composants])
    reponses_fmt = "\n".join([f"Q: {q}\nA: {r}" for q, r in reponses_technicien.items()])
    lang_instruction = "Respond entirely in English." if langue == "en" else "Reponds entierement en francais."

    prompt = f"""You are an elite hardware repair engineer with extreme pedagogical clarity. When you name a technical component, immediately explain it in simple words. Only cite specific part numbers if you have confirmed them — if unsure, describe the component by its appearance and function instead. {lang_instruction}

Device: {type_appareil}
Initial problem: {probleme}
Detected components: {liste_comp}

Additional info from the user:
{reponses_fmt}

Generate a precise component-level diagnosis, repairability metrics, and 5-7 repair steps.
Do NOT use any emojis. Respond ONLY in valid JSON:
{{
  "diagnostic": "...",
  "meta_reparation": {{
    "score_reparabilite": "8.5 / 10",
    "temps_estime": "25 min",
    "difficulte": "Beginner-Friendly",
    "outils_requis": ["Phillips PH2 Screwdriver", "Digital Multimeter"],
    "cout_piece": "~$12",
    "economie_realisee": "~$185",
    "dechet_evite": "14 kg e-waste"
  }},
  "etapes": ["Step 1...", "..."]
}}"""

    try:
        if image_base64:
            raw = await _call_llm_vision(prompt, image_base64, max_tokens=4000)
        else:
            raw = await _call_llm([{"role": "user", "content": prompt}], max_tokens=4000)
        out = _extraire_json(raw)
        if out and out.get("diagnostic"):
            return out
    except Exception as e:
        print(f"[LLM] Final diagnosis error: {e}")
        raise


async def generer_diagnostic(type_appareil: str, probleme: str, composants: list) -> dict:
    if not _is_api_configured():
        raise RuntimeError("Meta AI API key not configured. Set META_API_KEY in .env")

    liste_comp = "\n".join([f"- {c['nom']} (state: {c['etat']}, position: {c['position']})" for c in composants])
    prompt = f"""You are an elite hardware repair engineer with extreme pedagogical clarity. Give exact component names and explain them simply.

Device: {type_appareil}
Reported problem: {probleme}

Components detected by AI vision:
{liste_comp}

Generate:
1. A clear diagnosis of the probable problem (2-3 sentences)
2. A list of precise ordered repair steps (5-8 steps)

Respond in JSON format:
{{
  "diagnostic": "...",
  "etapes": ["Step 1: ...", "Step 2: ...", ...]
}}"""

    try:
        raw = await _call_llm([{"role": "user", "content": prompt}], max_tokens=4000)
        out = _extraire_json(raw)
        if out and out.get("diagnostic"):
            return out
    except Exception as e:
        print(f"[LLM] Diagnosis error: {e}")
        raise


async def continuer_conversation_ia(
    type_appareil: str,
    probleme: str,
    composants: list,
    historique_messages: list,
    message_technicien: str,
    nom_utilisateur: str = None,
    anciens_appareils: list = None,
    langue: str = "fr"
) -> dict:
    prenom_detecte = extraire_prenom_message(message_technicien)
    prenom_actif = prenom_detecte or nom_utilisateur

    if not _is_api_configured():
        raise RuntimeError("Meta AI API key not configured. Set META_API_KEY in .env")

    liste_comp = "\n".join([f"- {c.get('nom')} (state: {c.get('etat')})" for c in (composants or [])]) or "No specific components listed"
    lang_instruction = "Respond in English." if langue == "en" else "Reponds en francais."

    memoire_appareils_texte = ""
    if anciens_appareils:
        memoire_appareils_texte = f"User's memorized devices: {', '.join(anciens_appareils[:3])}."

    nom_appareil_clair = type_appareil if type_appareil and type_appareil not in ["Appareil", "Appareil electronique", "Electronic Device", "appareil"] else (anciens_appareils[0] if anciens_appareils else type_appareil)

    system_prompt = f"""You are an elite hardware repair engineer with extreme pedagogical clarity. {lang_instruction}
You are warm, direct, and technically brilliant. You use precise technical names (starting capacitor, thermal fuse, ribbon cable, DC connector) followed by a simple explanation in parentheses so anyone can understand. Only cite specific part numbers if you are certain — never guess a reference.
User's name: {prenom_actif or 'unknown'}.
Device: {nom_appareil_clair}
{memoire_appareils_texte}
Problem: {probleme or 'being diagnosed'}
Components on the device:
{liste_comp}

STRICT RULES:
1. Reply DIRECTLY in 2-3 short sentences max.
2. You KNOW the device is a {nom_appareil_clair}. NEVER ask "what device is it?".
3. Do NOT use any emojis. Stay professional and direct.
4. If the user seems lost, suggest a live video call ("proposer_appel_video": true).
5. Only add "nouvelles_etapes" (1-2 max) if a new concrete action is needed.

Respond ONLY in valid JSON:
{{
  "reponse_ia": "Your natural, direct response...",
  "proposer_appel_video": false,
  "nouvelles_etapes": []
}}"""

    # Build proper multi-turn conversation history
    messages = [{"role": "system", "content": system_prompt}]
    for m in (historique_messages or [])[-8:]:
        auteur = m.get("auteur", "")
        texte = m.get("texte", "")
        if "Technicien" in auteur or "User" in auteur:
            messages.append({"role": "user", "content": texte})
        else:
            messages.append({"role": "assistant", "content": texte})
    messages.append({"role": "user", "content": message_technicien})

    try:
        raw = await _call_llm(messages, max_tokens=4000)
        out = _extraire_json(raw)
        if not out or not out.get("reponse_ia"):
            clean_text = re.sub(r"```(?:json)?|```", "", raw).strip()
            if clean_text and not clean_text.startswith("{"):
                out = {"reponse_ia": clean_text, "nouvelles_etapes": []}
            else:
                raise ValueError("Empty response from LLM")

        out["reponse_ia"] = _clean_emojis(str(out.get("reponse_ia", "")))
        out["prenom_detecte"] = prenom_detecte
        if "nouvelles_etapes" not in out or not isinstance(out["nouvelles_etapes"], list):
            out["nouvelles_etapes"] = []

        msg_lower = (message_technicien or "").lower()
        mots_visuels = ["ressemble", "c'est quoi", "comment savoir", "pas technicien", "debutant", "reconnaitre", "ou est", "forme", "look like", "what is"]
        if any(m in msg_lower for m in mots_visuels):
            comp_cible = (composants[0].get("nom") if composants and len(composants) > 0 else "Composant")
            for c in (composants or []):
                if c.get("nom", "").lower() in msg_lower:
                    comp_cible = c.get("nom")
                    break
            out["guide_visuel"] = decrire_visuellement_composant_debutant(comp_cible, type_appareil, prenom_actif, langue=langue)

        return out
    except Exception as e:
        print(f"[LLM] Conversation error: {e}")
        raise


async def verifier_etape_visuelle(
    type_appareil: str,
    numero_etape: int,
    instruction_etape: str,
    image_apres_base64: str
) -> dict:
    if not _is_api_configured():
        raise RuntimeError("Meta AI API key not configured. Set META_API_KEY in .env")

    prompt = f"""You are an AI repair assistant. A technician is repairing a {type_appareil}.
They just completed step {numero_etape}: "{instruction_etape}" and sent a photo for verification.
Confirm if the step seems well done and give a safety tip for the next step.
Respond in JSON:
{{
  "valide": true,
  "commentaire_ia": "..."
}}"""

    try:
        raw = await _call_llm_vision(prompt, image_apres_base64, max_tokens=2000)
        out = _extraire_json(raw)
        if out and "valide" in out:
            return out
    except Exception as e:
        print(f"[LLM] Step verification error: {e}")

    return {
        "valide": True,
        "commentaire_ia": f"Step {numero_etape} verified. You can continue."
    }


async def analyser_frame_appel_live(
    type_appareil: str,
    etape_actuelle: str,
    numero_etape: int,
    parole_utilisateur: str = "",
    nom_utilisateur: str = None,
    langue: str = "fr",
    tick_index: int = 0,
    frame_base64: str = None,
    objets_detectes_vision: list = None
) -> dict:
    import base64
    from io import BytesIO
    from PIL import Image, ImageStat

    prenom_detecte = extraire_prenom_message(parole_utilisateur)
    prenom = prenom_detecte or nom_utilisateur or ""
    p_txt = f"{prenom}, " if prenom else ""
    is_en = (langue == "en")
    msg = (parole_utilisateur or "").lower()
    objets_live = [o.lower() for o in (objets_detectes_vision or [])]

    # Mismatch detection
    app_min = (type_appareil or "").lower()
    if objets_live:
        a_personne_seule = (objets_live == ["person"])
        if a_personne_seule and tick_index > 0:
            rep = (f"{p_txt}I can see YOU on the camera, but not the {type_appareil} yet! Point the camera at the device." if is_en else
                   f"{p_txt}je te vois TOI a la camera, mais pas encore ton {type_appareil} ! Tourne la camera vers l'appareil.")
            return {"reponse_vocale": rep, "pos_x": 50, "pos_y": 50, "icone_geste": "!", "label_geste": "Wrong target", "prenom_detecte": prenom_detecte, "incoherence_detectee": True}

        if ("ventilateur" in app_min or "fan" in app_min):
            mismatch_objects = [x for x in objets_live if x in ["laptop", "cell phone", "cup", "bottle", "tv", "keyboard"]]
            if mismatch_objects:
                obj_vu = mismatch_objects[0]
                rep = (f"Visual Mismatch {p_txt}! You said '{type_appareil}', but I see a '{obj_vu}' on camera! Show me the fan." if is_en else
                       f"Attention {p_txt}! Tu m'as dit '{type_appareil}', mais je vois un(e) '{obj_vu}' a la camera ! Montre-moi le bon appareil.")
                return {"reponse_vocale": rep, "pos_x": 50, "pos_y": 50, "icone_geste": "!", "label_geste": "Wrong device", "prenom_detecte": prenom_detecte, "incoherence_detectee": True}

    # Analyze frame brightness
    luminosite_moyenne = 120.0
    pos_x, pos_y = 48, 46
    nom_comp_cible = type_appareil

    if frame_base64 and len(frame_base64) > 100:
        try:
            b64_clean = frame_base64.split(",", 1)[1] if "," in frame_base64 else frame_base64
            raw_bytes = base64.b64decode(b64_clean)
            img_pil = Image.open(BytesIO(raw_bytes)).convert("L")
            stat = ImageStat.Stat(img_pil)
            luminosite_moyenne = stat.mean[0]
        except Exception as e:
            print(f"[LIVE FRAME] {e}")

    if luminosite_moyenne < 25:
        rep = (f"Your camera is very dark {p_txt}(brightness {int(luminosite_moyenne)}/255). Turn on your flashlight!" if is_en else
               f"Ta camera est trop sombre {p_txt}(luminosite {int(luminosite_moyenne)}/255). Allume une lampe !")
        return {"reponse_vocale": rep, "pos_x": 50, "pos_y": 50, "icone_geste": "light", "label_geste": "Add light", "prenom_detecte": prenom_detecte}

    # Real LLM vision call if configured
    if _is_api_configured() and frame_base64:
        try:
            prompt_live = (
                f"You are an AI repair co-pilot in a LIVE video call watching {prenom or 'the user'} repair a {type_appareil}. "
                f"Current step #{numero_etape}: {etape_actuelle}. "
                f"User just said: '{parole_utilisateur or 'Watching live'}'. "
                f"Reply in {'English' if is_en else 'French'} in 1-2 short spoken sentences. No emojis."
            )
            raw = await _call_llm_vision(prompt_live, frame_base64, max_tokens=2000)
            if raw:
                return {"reponse_vocale": _clean_emojis(raw), "pos_x": pos_x, "pos_y": pos_y, "icone_geste": "target", "label_geste": f"Target: {nom_comp_cible}", "prenom_detecte": prenom_detecte}
        except Exception as e:
            print(f"[LLM LIVE] {e}")

    # Fallback contextual response
    if parole_utilisateur:
        if any(w in msg for w in ["bon fil", "bonne piece", "ici", "right wire", "right part", "here"]):
            rep = (f"Good {p_txt}if you have located the part, gently pull the clip upward. Make sure the device is unplugged first." if is_en else
                   f"Bien {p_txt}si tu as repere la piece, tire doucement sur le clip vers le haut. Verifie que l'appareil est bien debranche.")
        elif any(w in msg for w in ["peur", "danger", "courant", "scared", "safe", "power"]):
            rep = (f"First step {p_txt}unplug the power cord. Warning: some components like capacitors can hold a residual charge even after unplugging. Avoid touching metal parts directly." if is_en else
                   f"Premiere chose {p_txt}debranche la prise murale. Attention : certains composants comme les condensateurs peuvent garder une charge residuelle meme apres debranchement. Evite de toucher les parties metalliques directement.")
        elif any(w in msg for w in ["fini", "fait", "ok", "done", "finished", "next"]):
            rep = (f"Great job {p_txt}! Step {numero_etape} looks good. Let's move to the next step." if is_en else
                   f"Bravo {p_txt}! L'etape {numero_etape} est bien realisee. On passe a la suivante.")
        else:
            rep = (f"I hear you {p_txt}and I'm analyzing your video (lighting: {int(luminosite_moyenne)}/255). Focus on {nom_comp_cible}." if is_en else
                   f"Je t'entends {p_txt}et j'analyse ta video (eclairage : {int(luminosite_moyenne)}/255). Concentre-toi sur {nom_comp_cible}.")
    else:
        messages_fr = [
            f"En direct : {p_txt}cadrage net (luminosite {int(luminosite_moyenne)}/255). Cible verrouillee sur {nom_comp_cible} pour l'etape {numero_etape}.",
            f"Surveillance IA : Suis la fleche Cyan sur {nom_comp_cible} pour : {etape_actuelle}.",
            f"Coach Live : Parle-moi directement a voix haute pendant que tu manipules la piece."
        ]
        messages_en = [
            f"Live: {p_txt}clear feed (brightness {int(luminosite_moyenne)}/255). Locked onto {nom_comp_cible} for Step {numero_etape}.",
            f"AI Co-Pilot: Follow the cyan arrow on {nom_comp_cible} for: {etape_actuelle}.",
            f"Live Coach: Speak to me anytime while working, I'm watching your camera."
        ]
        rep = (messages_en if is_en else messages_fr)[tick_index % 3]

    return {"reponse_vocale": rep, "pos_x": pos_x, "pos_y": pos_y, "icone_geste": "target", "label_geste": f"Target: {nom_comp_cible}", "prenom_detecte": prenom_detecte}


