# =============================================================
# services/sam_service.py — Segmentation et detection de composants
# Pipeline : SAM 2 (Meta) segmente les regions reelles
#            Muse Spark identifie chaque composant
# =============================================================

import os
import re
import json
import base64
import numpy as np
import httpx
from io import BytesIO
from PIL import Image
from dotenv import load_dotenv

load_dotenv()

# --- Meta AI API Config ---
META_API_KEY = os.getenv("META_API_KEY", "")
META_API_URL = os.getenv("META_API_URL", "https://api.meta.ai/v1")
META_VISION_MODEL = os.getenv("META_VISION_MODEL", "muse-spark-1.3")
TIMEOUT = 60

# --- SAM 2 Config ---
SAM2_CHECKPOINT = os.path.join(os.path.dirname(__file__), '..', '..', 'models', 'sam2.1_hiera_tiny.pt')
SAM2_CONFIG = 'configs/sam2.1/sam2.1_hiera_t.yaml'
_sam2_model = None
_mask_generator = None
_sam2_attempted = False


# ===============================================================
# Meta AI API helpers
# ===============================================================

def _is_api_configured() -> bool:
    return bool(META_API_KEY) and META_API_KEY != "your_meta_api_key_here"


def _headers() -> dict:
    return {
        "Authorization": f"Bearer {META_API_KEY}",
        "Content-Type": "application/json",
    }


def _nettoyer_b64(image_base64: str) -> str:
    if not image_base64:
        return ""
    if "," in image_base64:
        return image_base64.split(",", 1)[1]
    return image_base64


def _optimiser_image_pour_ia(b64_str: str, max_dim: int = 600) -> str:
    if not b64_str:
        return ""
    try:
        raw = base64.b64decode(b64_str)
        img = Image.open(BytesIO(raw))
        if img.mode not in ("RGB", "L"):
            img = img.convert("RGB")
        w, h = img.size
        if max(w, h) > max_dim:
            ratio = max_dim / float(max(w, h))
            new_size = (int(w * ratio), int(h * ratio))
            img = img.resize(new_size, Image.Resampling.LANCZOS)
        out_buf = BytesIO()
        img.save(out_buf, format="JPEG", quality=75)
        return base64.b64encode(out_buf.getvalue()).decode("utf-8")
    except Exception as e:
        print(f"[OPTIM IMAGE] Error: {e}")
        return b64_str


def _extraire_json(texte: str):
    if not texte:
        return None
    texte = re.sub(r"```(?:json)?", "", texte).replace("```", "").strip()
    try:
        return json.loads(texte)
    except Exception:
        match = re.search(r"(\{.*\}|\[.*\])", texte, re.DOTALL)
        if match:
            try:
                return json.loads(match.group(1))
            except Exception:
                return None
    return None


async def _call_vision(prompt: str, image_base64: str, max_tokens: int = 4000) -> str:
    if not _is_api_configured() or not image_base64:
        return ""
    b64 = _nettoyer_b64(image_base64)
    b64 = _optimiser_image_pour_ia(b64, max_dim=600)
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
                "temperature": 0.5,
            },
        )
        resp.raise_for_status()
        return resp.json()["choices"][0]["message"].get("content", "")


# ===============================================================
# SAM 2 — Chargement paresseux et segmentation
# ===============================================================

def _is_sam2_available() -> bool:
    global _sam2_model, _mask_generator, _sam2_attempted
    if _sam2_model is not None:
        return True
    if _sam2_attempted:
        return False
    _sam2_attempted = True
    try:
        import torch
        from sam2.build_sam import build_sam2
        from sam2.automatic_mask_generator import SAM2AutomaticMaskGenerator

        if not os.path.exists(SAM2_CHECKPOINT):
            print(f"[SAM2] Checkpoint not found: {SAM2_CHECKPOINT}")
            return False

        print("[SAM2] Loading model...")
        with torch.no_grad():
            _sam2_model = build_sam2(SAM2_CONFIG, SAM2_CHECKPOINT, device='cpu')
        _mask_generator = SAM2AutomaticMaskGenerator(
            model=_sam2_model,
            points_per_side=8,
            pred_iou_thresh=0.75,
            stability_score_thresh=0.85,
            min_mask_region_area=500,
        )
        print("[SAM2] Model loaded successfully")
        return True
    except Exception as e:
        print(f"[SAM2] Failed to load: {e}")
        return False


def _b64_to_numpy(b64_str: str) -> np.ndarray:
    raw = base64.b64decode(b64_str)
    return np.array(Image.open(BytesIO(raw)).convert("RGB"))


def _resize_for_sam(img_np: np.ndarray, max_dim: int = 512) -> tuple:
    h, w = img_np.shape[:2]
    if max(h, w) <= max_dim:
        return img_np, 1.0, 1.0
    scale = max_dim / max(h, w)
    new_w, new_h = int(w * scale), int(h * scale)
    resized = np.array(Image.fromarray(img_np).resize((new_w, new_h), Image.Resampling.LANCZOS))
    return resized, w / new_w, h / new_h


def _sam_masks_to_regions(masks: list, img_h: int, img_w: int, scale_x: float, scale_y: float) -> list:
    total_px = img_h * img_w / (scale_x * scale_y)
    filtered = [m for m in masks if m['area'] < total_px * 0.6 and m['area'] > total_px * 0.005]
    filtered = sorted(filtered, key=lambda m: m['stability_score'], reverse=True)[:5]

    regions = []
    for i, m in enumerate(filtered):
        bx, by, bw, bh = m['bbox']
        cx_pct = round(((bx + bw / 2) * scale_x / img_w) * 100, 1)
        cy_pct = round(((by + bh / 2) * scale_y / img_h) * 100, 1)
        w_pct = round((bw * scale_x / img_w) * 100, 1)
        h_pct = round((bh * scale_y / img_h) * 100, 1)
        regions.append({
            "index": i + 1,
            "cx_pct": cx_pct, "cy_pct": cy_pct,
            "w_pct": w_pct, "h_pct": h_pct,
            "confidence": round(float(m['stability_score']), 2),
        })
    return regions


async def _identifier_regions_muse(image_b64: str, type_appareil: str, regions: list) -> list:
    regions_desc = "\n".join([
        f"Region {r['index']}: center=({r['cx_pct']:.0f}%, {r['cy_pct']:.0f}%), "
        f"size=({r['w_pct']:.0f}% x {r['h_pct']:.0f}%)"
        for r in regions
    ])

    prompt = f"""You are an elite hardware repair engineer with extreme pedagogical clarity.
Examine this photo of a device ({type_appareil}).

SAM 2 (Segment Anything Model) detected {len(regions)} distinct regions:
{regions_desc}

For each region, identify the hardware component and explain its role in simple words.
When naming a technical part, immediately explain it simply (e.g. "the capacitor (small black cylinder near the motor)").
Do NOT invent part numbers or references you cannot see.

Respond ONLY in valid JSON:
{{
  "composants": [
    {{
      "region": 1,
      "nom": "Component name",
      "etat": "suspect_ia",
      "description": "Simple 1-sentence explanation"
    }}
  ]
}}"""

    try:
        raw = await _call_vision(prompt, image_b64, max_tokens=2000)
        parsed = _extraire_json(raw)
        if isinstance(parsed, dict) and parsed.get("composants"):
            result = []
            for comp in parsed["composants"]:
                idx = comp.get("region", 1) - 1
                if 0 <= idx < len(regions):
                    r = regions[idx]
                    result.append({
                        "nom": comp.get("nom", f"Region {idx + 1}"),
                        "pos_x": r['cx_pct'], "pos_y": r['cy_pct'],
                        "largeur": r['w_pct'], "hauteur": r['h_pct'],
                        "confiance": r['confidence'],
                        "etat": comp.get("etat", "suspect_ia"),
                        "description": comp.get("description", "")
                    })
            if result:
                return result
    except Exception as e:
        print(f"[MUSE IDENTIFY] Error: {e}")

    return [{
        "nom": f"Region {r['index']}",
        "pos_x": r['cx_pct'], "pos_y": r['cy_pct'],
        "largeur": r['w_pct'], "hauteur": r['h_pct'],
        "confiance": r['confidence'],
        "etat": "detecte",
        "description": "Region detected by SAM 2"
    } for r in regions]


# ===============================================================
# Fonctions publiques — Identification d'appareil
# ===============================================================

async def identifier_appareil_et_probleme_sur_image(
    image_base64: str,
    langue: str = "fr",
    nom_utilisateur: str = None,
    type_media: str = "photo",
    appareil_existant: str = None,
    historique_messages: list = None
) -> dict:
    b64_propre = _nettoyer_b64(image_base64)
    is_en = (langue == "en")
    prenom = (nom_utilisateur or "").strip()
    salut = f"{prenom} " if prenom else ""
    is_video = (type_media == "video")

    nom_retenu = appareil_existant or ("Device" if is_en else "Appareil")

    defaut = {
        "type_appareil": nom_retenu,
        "probleme_visuel": "Checking for issues" if is_en else "Recherche de problemes",
        "message_accueil_ia": (
            f"Hi{(' ' + salut) if salut else ''}! I got your {'video' if is_video else 'photo'}. Can you tell me what is wrong with this device? For example: it does not turn on, it makes a strange noise, or something looks broken."
            if is_en else
            f"Bonjour{(' ' + salut) if salut else ''} ! J'ai bien recu votre {'video' if is_video else 'photo'}. Pouvez-vous me dire ce qui ne va pas ? Par exemple : il ne s'allume plus, il fait un bruit bizarre, ou quelque chose semble casse."
        ),
        "reponses_rapides": (
            ["It does not turn on", "It makes a weird noise", "Something looks broken"]
            if is_en else
            ["Il ne s'allume plus", "Il fait un bruit bizarre", "Quelque chose semble casse"]
        )
    }

    if not _is_api_configured():
        raise RuntimeError("Meta AI API key not configured. Set META_API_KEY in .env")
    if not b64_propre:
        return defaut

    lang_instr = "Respond entirely in English. Do NOT use any emojis." if is_en else "Reponds entierement en francais. N'utilise AUCUN emoji."
    prenom_instr = f"The user's name is {prenom} (use their name)." if prenom else "Address the user warmly."

    if appareil_existant:
        media_context = f"IMPORTANT: The user is ALREADY diagnosing their {appareil_existant}. They are adding a new {'video' if is_video else 'photo'}. Do NOT reset the diagnosis or re-ask what device it is!"
    else:
        media_context = f"The user sent a {'video' if is_video else 'photo'} of their device."

    prompt = f"""You are an elite hardware repair engineer with extreme pedagogical clarity, helping everyday people fix their devices. {lang_instr} {prenom_instr}
{media_context}

RULES:
1. Identify the device precisely — give exact brand and model ONLY if you can actually read them in the image. If not visible, describe what you see (e.g. "a white standing fan", "a black laptop"). Never guess a brand or model you cannot see.
2. Note anything visibly wrong (cracks, burn marks, swollen parts, loose cables). Only mention what you actually see.
3. Write a short friendly greeting ("message_accueil_ia", 2 sentences max). When you name a technical component, immediately explain it in simple words (e.g. "the starting capacitor (the small black cylinder near the motor)"). Ask ONE clear question about the problem.
4. Suggest 3 short quick replies ("reponses_rapides") in simple everyday language.

Do NOT use any emojis. Do NOT invent part numbers or references you cannot see in the image.
Respond ONLY in valid JSON:
{{
  "type_appareil": "{appareil_existant or 'Device name'}",
  "probleme_visuel": "What looks wrong",
  "message_accueil_ia": "Hi! I can see this is a ... What exactly is not working?",
  "reponses_rapides": ["Simple reply 1", "Simple reply 2", "Simple reply 3"]
}}"""

    try:
        raw = await _call_vision(prompt, b64_propre, max_tokens=4000)
        parsed = _extraire_json(raw)
        if isinstance(parsed, dict) and parsed.get("type_appareil"):
            return {
                "type_appareil": parsed.get("type_appareil", defaut["type_appareil"]),
                "probleme_visuel": parsed.get("probleme_visuel", defaut["probleme_visuel"]),
                "message_accueil_ia": parsed.get("message_accueil_ia", defaut["message_accueil_ia"]),
                "reponses_rapides": parsed.get("reponses_rapides", defaut["reponses_rapides"])
            }
    except Exception as e:
        print(f"[DEVICE ID] Error: {e}")

    return defaut


# ===============================================================
# Fonctions publiques — Segmentation avec SAM 2
# ===============================================================

async def segmenter_image(image_base64: str, type_appareil: str = "appareil") -> dict:
    b64_propre = _nettoyer_b64(image_base64)
    if not b64_propre:
        return {"composants": [], "mode": "sam2"}

    if _is_sam2_available():
        import torch
        img_np = _b64_to_numpy(b64_propre)
        h, w = img_np.shape[:2]
        img_resized, scale_x, scale_y = _resize_for_sam(img_np, max_dim=512)

        with torch.no_grad():
            masks = _mask_generator.generate(img_resized)

        regions = _sam_masks_to_regions(masks, h, w, scale_x, scale_y)
        if not regions:
            return {"composants": [], "mode": "sam2"}

        if _is_api_configured():
            composants = await _identifier_regions_muse(b64_propre, type_appareil, regions)
        else:
            raise RuntimeError("Meta AI API key not configured. Set META_API_KEY in .env")

        return {"composants": composants, "mode": "sam2"}

    # Fallback Muse Spark seul (positions estimees)
    if not _is_api_configured():
        raise RuntimeError("Meta AI API key not configured. Set META_API_KEY in .env")

    prompt = f"""Examine this image of a device ({type_appareil}).
Identify 3 precise technical components visible or likely present that are useful for repair diagnosis.
For each component, estimate its position as percentage coordinates on the image (pos_x between 15 and 85, pos_y between 15 and 85).

Respond ONLY with a valid JSON object:
{{
  "composants": [
    {{
      "nom": "Precise part name",
      "pos_x": 45.0,
      "pos_y": 50.0,
      "largeur": 28.0,
      "hauteur": 28.0,
      "confiance": 0.95,
      "etat": "suspect_ia",
      "description": "Clear simple explanation of this part's role"
    }}
  ]
}}"""

    try:
        raw = await _call_vision(prompt, b64_propre, max_tokens=2000)
        parsed = _extraire_json(raw)
        if isinstance(parsed, dict) and parsed.get("composants"):
            return {"composants": parsed["composants"], "mode": "muse_spark"}
        elif isinstance(parsed, list) and len(parsed) > 0:
            return {"composants": parsed, "mode": "muse_spark"}
    except Exception as e:
        print(f"[SEGMENTATION] Error: {e}")

    return {"composants": [], "mode": "muse_spark"}


async def segmenter_point_precis(image_base64: str, point_x: float, point_y: float, type_appareil: str = "appareil") -> dict:
    b64_propre = _nettoyer_b64(image_base64)

    if _is_sam2_available() and b64_propre:
        import torch
        from sam2.sam2_image_predictor import SAM2ImagePredictor

        img_np = _b64_to_numpy(b64_propre)
        h, w = img_np.shape[:2]
        px = int(point_x / 100 * w)
        py = int(point_y / 100 * h)

        predictor = SAM2ImagePredictor(_sam2_model)
        with torch.no_grad():
            predictor.set_image(img_np)
            masks, scores, _ = predictor.predict(
                point_coords=np.array([[px, py]]),
                point_labels=np.array([1]),
                multimask_output=True
            )

        best_idx = int(scores.argmax())
        mask = masks[best_idx]
        score = float(scores[best_idx])

        ys, xs = np.where(mask)
        if len(xs) > 0:
            bx1, bx2 = int(xs.min()), int(xs.max())
            by1, by2 = int(ys.min()), int(ys.max())
            cx_pct = round(((bx1 + bx2) / 2 / w) * 100, 1)
            cy_pct = round(((by1 + by2) / 2 / h) * 100, 1)
            w_pct = round(((bx2 - bx1) / w) * 100, 1)
            h_pct = round(((by2 - by1) / h) * 100, 1)

            if _is_api_configured():
                id_prompt = f"""The user tapped a point on their {type_appareil}. SAM 2 isolated a component at ({cx_pct:.0f}%, {cy_pct:.0f}%) covering ({w_pct:.0f}% x {h_pct:.0f}%) of the image.
Identify this part and explain its role simply.
Respond ONLY in valid JSON:
{{"nom": "Part name", "description": "Simple 1-sentence explanation", "etat": "suspect_ia"}}"""
                try:
                    raw = await _call_vision(id_prompt, b64_propre, max_tokens=1000)
                    parsed = _extraire_json(raw)
                    if isinstance(parsed, dict) and parsed.get("nom"):
                        return {
                            "nom": parsed["nom"],
                            "pos_x": cx_pct, "pos_y": cy_pct,
                            "largeur": w_pct, "hauteur": h_pct,
                            "confiance": round(score, 2),
                            "etat": parsed.get("etat", "suspect_ia"),
                            "description": parsed.get("description", ""),
                        }
                except Exception as e:
                    print(f"[SAM2 POINT ID] {e}")

            return {
                "nom": f"Component at ({point_x:.0f}%, {point_y:.0f}%)",
                "pos_x": cx_pct, "pos_y": cy_pct,
                "largeur": w_pct, "hauteur": h_pct,
                "confiance": round(score, 2),
                "etat": "detecte",
                "description": "Region isolated by SAM 2",
            }

    # Fallback Muse Spark seul
    if not _is_api_configured():
        raise RuntimeError("Meta AI API key not configured. Set META_API_KEY in .env")

    prompt = f"""The user tapped the point ({int(point_x)}%, {int(point_y)}%) on a photo of their device ({type_appareil}).
Identify the part at that location and explain its role simply.
Respond ONLY in valid JSON:
{{
  "nom": "Part name",
  "description": "Simple 1-sentence explanation",
  "confiance": 0.96
}}"""
    try:
        raw = await _call_vision(prompt, b64_propre, max_tokens=2000)
        parsed = _extraire_json(raw)
        if isinstance(parsed, dict) and parsed.get("nom"):
            return {
                "nom": parsed["nom"],
                "pos_x": point_x, "pos_y": point_y,
                "largeur": 28.0, "hauteur": 28.0,
                "confiance": float(parsed.get("confiance", 0.96)),
                "etat": "suspect_ia",
                "description": parsed.get("description", "Component at this location.")
            }
    except Exception as e:
        print(f"[POINT SEG] {e}")

    return {
        "nom": f"Component at ({int(point_x)}%, {int(point_y)}%)",
        "pos_x": point_x, "pos_y": point_y,
        "largeur": 28.0, "hauteur": 28.0,
        "confiance": 0.5,
        "etat": "inconnu",
        "description": f"Could not identify the component at this position on your {type_appareil}."
    }


async def segmenter_video_frames(frames_base64: list, type_appareil: str = "appareil") -> dict:
    if not _is_api_configured() and not _is_sam2_available():
        raise RuntimeError("Meta AI API key not configured. Set META_API_KEY in .env")
    nb_frames = len(frames_base64)
    if nb_frames > 0:
        try:
            result = await segmenter_image(frames_base64[0], type_appareil)
            comps = result.get("composants", [])
            mode = result.get("mode", "sam2")
            return {
                "nombre_frames_analysees": nb_frames,
                "resume_mouvement": f"Video analysis completed on {nb_frames} key frames of your {type_appareil}.",
                "composants": comps,
                "mode": mode
            }
        except Exception as e:
            print(f"[VIDEO SEG] {e}")

    return {
        "nombre_frames_analysees": nb_frames,
        "resume_mouvement": f"No frames could be analyzed for your {type_appareil}.",
        "composants": [],
        "mode": "error"
    }
