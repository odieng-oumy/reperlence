# RepairLens

**AI-powered device repair assistant that sees, listens, and guides you step-by-step.**

> Built for the Meta Global AI Developer Hackathon 2026

<!-- 🎬 Demo video: link will be added here -->

---

## The Problem

Over **50 million tons** of electronic waste are generated each year ([UN Global E-waste Monitor 2024](https://ewastemonitor.info/)). Most broken devices — fans, coffee makers, small appliances — could be repaired with basic guidance. But everyday users can't identify faulty parts, understand technical jargon, or know where to start.

**RepairLens** turns any smartphone camera into a repair mentor powered by Meta AI.

---

## How It Works

```
 Photo/Video  -->  SAM 2 (Meta)  -->  Muse Spark 1.3  -->  AI Diagnosis  -->  Step-by-Step Repair
     |                  |                    |                    |                     |
  Camera API      Pixel-accurate      Component           Multi-turn           Voice-guided
  (browser)       segmentation        identification       conversation         instructions
```

### Core Features

| Feature | Description |
|:---|:---|
| **Background Removal** | SAM 2 extracts the device from its background — the device appears isolated with a glowing cyan outline. Requires SAM 2 installed locally; without it, the endpoint returns an empty mask |
| **AI Vision Analysis** | SAM 2 segments component regions, then Muse Spark 1.3 identifies each part and its condition (damaged or intact). When SAM 2 is not installed, Muse Spark estimates component regions from the image alone (mode: `muse_spark`) |
| **Multi-View Defect Scan** | The AI inspects the device from multiple simulated views and builds a defect list grouped by angle (e.g. "Front: cracked screen", "Left side: dented casing") — each view is a separate API call to Muse Spark |
| **Component Segmentation** | Touch any part on the image — SAM 2 isolates the exact region, Muse Spark names it in plain language |
| **Smart Diagnosis** | Multi-turn conversation: the AI asks targeted questions before generating a diagnosis — but like any LLM, it can make mistakes |
| **Guided Repair** | Step-by-step instructions: one action per step, part name first, with safety warnings when needed. A "I don't understand" button breaks any step into 3-5 micro-actions |
| **Voice Copilot** | Hands-free: speak your answers, hear the AI's guidance (Web Speech API) |
| **Live Video Call** | Live video analysis while you work — the AI watches and guides |
| **Acoustic Analysis** | Records device sounds, runs FFT spectrum analysis and flags frequency patterns that may indicate mechanical issues (basic heuristics, not a trained classifier) |
| **Repair Memory** | PostgreSQL stores full conversation history — resume any session days later |
| **Bilingual** | Full French and English support, switchable in one click |
| **Repair Passport** | Exportable PDF with diagnosis, steps taken, parts replaced, and e-waste saved |

---

## Tech Stack

| Layer | Technology |
|:---|:---|
| **Backend** | Python 3.10+, FastAPI, SQLAlchemy 2.0, PostgreSQL |
| **AI** | Meta SAM 2 (segmentation) + Muse Spark 1.3 (vision + text, multimodal) |
| **Frontend** | Vanilla HTML/CSS/JS — no framework, zero build step |
| **Voice** | Web Speech API (SpeechSynthesis + SpeechRecognition) |
| **Audio** | Web Audio API (FFT spectral analysis) |
| **Detection** | TensorFlow.js COCO-SSD (client-side object detection) |

---

## Project Structure

```
repairlens/
├── main.py                     # FastAPI entrypoint, static mounts, health route
├── requirements.txt            # Python dependencies
├── .env.example                # Environment template (copy to .env)
├── init_db.py                  # Database initialization script
├── backend/
│   ├── database/
│   │   ├── database.py         # SQLAlchemy engine + session (PostgreSQL)
│   │   ├── models.py           # 4 tables: sessions, components, steps, messages
│   │   └── crud.py             # All database operations + cross-session memory
│   ├── routes/
│   │   ├── camera.py           # Camera capture endpoints
│   │   ├── segmentation.py     # Image segmentation + touch-to-identify + video frames
│   │   ├── diagnostic.py       # AI evaluation, diagnosis, live video, conversation
│   │   └── history.py          # User-isolated repair history
│   └── services/
│       ├── sam_service.py      # SAM 2 segmentation + Muse Spark component identification
│       └── muse_service.py     # Diagnostic reasoning engine (Meta AI + multi-turn)
├── frontend/
│   ├── index.html              # Home dashboard
│   ├── camera.html             # Main inspection flow (3 screens: Analyse, Diagnostic, Repair)
│   ├── history.html            # Repair history
│   ├── motion.html             # Promotional landing page
│   ├── css/                    # Cyan Neon design system (responsive)
│   └── js/                     # Frontend logic, voice, audio FFT, i18n
└── tests/
    └── test_api.py             # API smoke tests
```

---

## Quick Start

### Prerequisites
- Python 3.10+
- PostgreSQL (create a database named `repairlens_db`)
- A Meta AI API key ([llama.developer.meta.com](https://llama.developer.meta.com/))
- (Optional) PyTorch + SAM 2 model for local segmentation — without it, the app uses Muse Spark vision for component detection (but background removal is unavailable)

### Install

```bash
git clone https://github.com/odieng-oumy/reperlence.git
cd reperlence
pip install -r requirements.txt
cp .env.example .env
# Edit .env with your Meta API key and database credentials
```

### Download SAM 2 Model (optional, ~156 MB)

```bash
mkdir models
python -c "import urllib.request; urllib.request.urlretrieve('https://dl.fbaipublicfiles.com/segment_anything_2/092824/sam2.1_hiera_tiny.pt', 'models/sam2.1_hiera_tiny.pt')"
```

### Initialize Database

```bash
python init_db.py
```

### Run

```bash
python -m uvicorn main:app --reload --port 8000
```

Open **http://localhost:8000** in your browser.

### Test

Requires a running PostgreSQL database with the schema initialized (`python init_db.py`).

```bash
python -m pytest tests/ -v
```

---

## Architecture Decisions

- **No frontend framework** — Zero build step means instant demo with no toolchain.
- **Async + one sync exception** — Most Meta AI API calls use `httpx.AsyncClient`. The visual part guide (`guide-visuel-piece`) makes a synchronous Wikipedia lookup for reference images, which blocks the worker during that call.
- **Two Meta models** — SAM 2 provides pixel-accurate segmentation masks; Muse Spark 1.3 identifies and names each region. When SAM 2 is not available, Muse Spark estimates component positions from the image (mode: `muse_spark`). The response includes a `mode` field so the frontend knows which pipeline ran.
- **Image optimization** — Photos are resized to 512px for SAM 2 inference and 600px for Muse Spark, keeping both fast on CPU.
- **Multi-turn reasoning** — The AI asks 2-3 targeted questions before generating a diagnosis, using the full conversation context.

---

## API Endpoints

### Segmentation (SAM 2 + Muse Spark)

| Method | Endpoint | Description |
|:---|:---|:---|
| `POST` | `/api/segmentation/identifier-image` | Auto-detect device type and problem from a photo |
| `POST` | `/api/segmentation/analyser` | Segment and identify components from a photo |
| `POST` | `/api/segmentation/segmenter-point` | Identify the component at a tapped (x, y) point |
| `POST` | `/api/segmentation/detourer` | SAM 2 background removal (returns mask + timing) |
| `POST` | `/api/segmentation/analyser-vue` | Analyze a specific angle for new defects (multi-view scan) |
| `POST` | `/api/segmentation/analyser-video` | Analyze multiple video frames |
| `GET`  | `/api/segmentation/composants/{id}` | Get detected components for a session |

### Diagnostic (Muse Spark)

| Method | Endpoint | Description |
|:---|:---|:---|
| `POST` | `/api/diagnostic/evaluer` | Start diagnosis — AI asks clarifying questions |
| `POST` | `/api/diagnostic/diagnostic-final` | Generate full diagnosis with user's answers |
| `POST` | `/api/diagnostic/continuer` | Continue multi-turn conversation |
| `POST` | `/api/diagnostic/micro-actions` | Break a repair step into 3-5 simple micro-actions |
| `POST` | `/api/diagnostic/guide-visuel-piece` | Visual part guide for beginners (zero jargon) |
| `POST` | `/api/diagnostic/appel-video-live` | Live video frame analysis with voice guidance |
| `POST` | `/api/diagnostic/verifier-etape` | Verify a completed step via before/after photo |

### History

| Method | Endpoint | Description |
|:---|:---|:---|
| `GET`  | `/api/history/` | Get user's repair sessions (header: `X-Utilisateur-Id`) |
| `GET`  | `/api/history/{id}` | Get full session with messages, steps, components |
| `POST` | `/api/history/nouvelle` | Create a new repair session |
| `PUT`  | `/api/history/{id}/resoudre` | Mark a repair as completed |

---

## Known Limitations

- **SAM 2 on CPU** — Segmentation runs on CPU by default. A single image takes several seconds; a dedicated GPU would bring this under 1 second.
- **Browser voice** — Speech recognition and synthesis depend on the browser's Web Speech API. Quality varies across browsers and languages; Chrome gives the best results.
- **Muse Spark fallback** — Without SAM 2, component regions are estimated by the vision model rather than pixel-segmented. Background removal (`/detourer`) is not available at all without SAM 2.
- **Single-image multi-view** — The multi-view defect scan rotates and reanalyzes the same photo. For a true 360° inspection, the user should take photos from multiple angles manually.
- **Acoustic heuristics** — The frequency analysis uses fixed thresholds, not a trained model. It flags patterns but cannot reliably diagnose specific faults.

---

## Safety Notice

**RepairLens is an educational assistant, not a substitute for a qualified repair technician.**

- **Electrical safety** — Never open a device that is plugged in. Capacitors in power supplies, microwaves, and CRT monitors can hold lethal charge even when unplugged. If the AI suggests opening such a device, consult a professional first.
- **AI limitations** — The diagnosis is generated by a language model. It can be wrong. Always cross-check critical steps (especially anything involving mains voltage, gas, or pressurized systems) with a qualified source.
- **Physical risk** — Broken glass, sharp metal edges, and chemical leaks (batteries) are common in damaged electronics. Wear appropriate protection.

---

## Data & Privacy

- **Meta AI API** — Image and text data is sent to Meta's API servers for analysis. Under Meta's free-tier API terms, submitted content may be used to improve their models. Do not send images containing personal or sensitive information you would not want processed by a third party.
- **Local database** — Repair sessions, messages, and component data are stored in your PostgreSQL database. No data is shared with third parties beyond the Meta AI API calls.
- **No telemetry** — RepairLens does not collect analytics or send data to any server other than the Meta AI API.

---

## License

MIT — see [LICENSE](LICENSE)

---

*Built by Oumy Dieng for the Meta Global AI Developer Hackathon 2026*
