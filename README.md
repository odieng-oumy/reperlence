# RepairLens

**AI-powered device repair assistant that sees, listens, and guides you step-by-step.**

> Built for the Meta Global AI Developer Hackathon 2026

---

## The Problem

Over **50 million tons** of electronic waste are discarded every year. Most broken devices — fans, coffee makers, small appliances — could be repaired with basic guidance. But everyday users can't identify faulty parts, understand technical jargon, or know where to start.

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
| **Background Removal** | SAM 2 extracts the device from its background in real-time — the device appears isolated with a glowing cyan outline on the dark interface |
| **AI Vision Analysis** | SAM 2 segments real component regions, then Muse Spark 1.3 identifies each part |
| **360° Defect Scan** | The AI inspects 4 angles and builds a live defect list grouped by view (e.g. "Front: cracked screen", "Right side: dented casing") — each defect comes from a real API call, nothing simulated |
| **Component Segmentation** | Touch any part on the image — SAM 2 isolates the exact region, Muse Spark names it in plain language |
| **Smart Diagnosis** | Multi-turn conversation: the AI asks targeted questions before generating a diagnosis |
| **Guided Repair** | Step-by-step repair instructions with difficulty rating, tools needed, and safety warnings |
| **Voice Copilot** | Hands-free: speak your answers, hear the AI's guidance (Web Speech API) |
| **Live Video Call** | Real-time video analysis while you work — the AI watches and guides |
| **Acoustic Analysis** | Records motor/appliance sounds, analyzes frequency spectrum to detect faults |
| **Repair Memory** | PostgreSQL stores full conversation history — resume any session days later |
| **Bilingual** | Full English and French support, switchable in one click |
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
│   ├── camera.html             # Main inspection flow (4 screens with progress bar)
│   ├── history.html            # Repair history
│   ├── motion.html             # Video analysis mode
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
- A Meta AI API key

### Install

```bash
git clone https://github.com/your-username/repairlens.git
cd repairlens
pip install -r requirements.txt
cp .env.example .env
# Edit .env with your Meta API key and database credentials
```

### Download SAM 2 Model

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

```bash
python -m pytest tests/ -v
```

---

## Architecture Decisions

- **No frontend framework** — Zero build step means instant demo. The jury can clone and run in 30 seconds.
- **Async everywhere** — All Meta AI API calls use `httpx.AsyncClient` so the server never blocks, even under concurrent users.
- **Two Meta models** — SAM 2 provides pixel-accurate segmentation masks; Muse Spark 1.3 identifies and names each region. The pipeline uses real computer vision, not guessed coordinates.
- **Image optimization** — Photos are resized to 512px for SAM 2 inference and 600px for Muse Spark, keeping both fast on CPU.
- **Multi-turn reasoning** — The AI doesn't guess. It asks 2-3 targeted questions, then generates a diagnosis with the full conversation context.

---

## API Endpoints

| Method | Endpoint | Description |
|:---|:---|:---|
| `GET` | `/api/health` | Health check + database status |
| `POST` | `/api/segmentation/segmenter` | Segment components from a photo |
| `POST` | `/api/segmentation/point` | Identify a specific tapped component |
| `POST` | `/api/segmentation/identifier-appareil` | Identify device type from photo |
| `POST` | `/api/diagnostic/evaluer` | Start diagnosis — AI asks questions |
| `POST` | `/api/diagnostic/diagnostic-final` | Generate full diagnosis with answers |
| `POST` | `/api/diagnostic/continuer` | Continue multi-turn conversation |
| `POST` | `/api/diagnostic/appel-live` | Live video frame analysis |
| `GET` | `/api/history/sessions` | Get user's repair sessions |

---

## License

MIT

---

*Built by Oumy Dieng for the Meta Global AI Developer Hackathon 2026*
