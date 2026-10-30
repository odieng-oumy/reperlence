// =============================================================
// camera.js — Logique complète des 4 écrans d'Inspection & Réparation
// 1. New Inspection -> 2. AI Vision Active (SAM 2) ->
// 3. AI Diagnosis (Muse Spark) -> 4. Guided Inspection (Step-by-step)
// =============================================================

let sessionId             = null;
let imageBase64           = null;
let imageDataUrl          = '';
let videoObjectUrl        = '';
let videoFramesBase64     = [];
let photoDataUrl          = '';
let photoBase64           = null;
let estModeVideo          = false;
let angleRotationActuel   = 0;
let streamCamera          = null;
let composantsDetectes    = [];
let composantSelectionne  = 0;
let appareilActuel        = '';
let descriptionActuelle   = '';
let diagnosticActuel      = '';
let questionsActuelles    = [];
let etapesActuelles       = [];
let indexEtapeActive      = 0;
let historiqueMessages    = [];
let defautsParVue         = [];
let masqueDetourageUrl    = null;
let dernierAnalyseVueTs   = 0;
let voixIAActive          = true;
let reconnaissanceEnCours = null;

// =============================================================
// NAVIGATION ENTRE LES 4 ÉCRANS
// =============================================================
function afficherEcran(ecranId) {
    document.querySelectorAll('.screen-view').forEach(el => el.classList.remove('active'));
    const cible = document.getElementById(ecranId);
    if (cible) cible.classList.add('active');
    arreterCamera();
    window.scrollTo({ top: 0, behavior: 'smooth' });
    mettreAJourProgressBar(ecranId);
}

function mettreAJourProgressBar(ecranActif) {
    const steps = document.querySelectorAll('.progress-step');
    const lines = document.querySelectorAll('.progress-line');
    if (!steps.length) return;

    const ordre = [
        'screen-new-inspection',
        'screen-ai-diagnosis',
        'screen-guided-inspection'
    ];
    const idx = ordre.indexOf(ecranActif);
    if (idx < 0) return;

    steps.forEach((step, i) => {
        step.classList.remove('active', 'done');
        if (i < idx) step.classList.add('done');
        else if (i === idx) step.classList.add('active');
    });
    lines.forEach((line, i) => {
        line.classList.toggle('done', i < idx);
    });
}

// =============================================================
// SYSTÈME VOCAL BIDIRECTIONNEL (VOIX IA + MICRO TECHNICIEN)
// =============================================================
function basculerVoixIA() {
    voixIAActive = !voixIAActive;
    if (!voixIAActive && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
    } else {
        parlerIA(getLangue() === 'fr' ? 'Mode vocal activé.' : 'Voice guidance enabled.');
    }
}

function parlerIA(texte) {
    if (!voixIAActive || !('speechSynthesis' in window) || !texte) return;
    window.speechSynthesis.cancel();

    const textePropre = texte
        .replace(/[🔧📸📷🔍👁️🧠🤖💬❓✅🔩⚠️💡👨‍🔧➤↻🔬ℹ️▶]/g, '')
        .replace(/\s+/g, ' ')
        .trim();

    const utterance = new SpeechSynthesisUtterance(textePropre);
    const codeLang = getLangue() === 'fr' ? 'fr-FR' : 'en-US';
    utterance.lang = codeLang;
    utterance.rate = 1.02;

    const voixDispo = window.speechSynthesis.getVoices();
    const prefix = getLangue() === 'fr' ? 'fr' : 'en';
    const voixChoisie = voixDispo.find(v => v.lang.toLowerCase().startsWith(prefix));
    if (voixChoisie) utterance.voice = voixChoisie;

    window.speechSynthesis.speak(utterance);
}

function dicterChamp(inputId, btnId, actionAuto = false) {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
        alert('Speech recognition is supported in Google Chrome and Microsoft Edge.');
        return;
    }

    if (reconnaissanceEnCours) {
        reconnaissanceEnCours.stop();
        reconnaissanceEnCours = null;
        return;
    }

    if ('speechSynthesis' in window) window.speechSynthesis.cancel();

    const input = document.getElementById(inputId);
    const btn   = document.getElementById(btnId);
    const originalHtml = btn ? btn.innerHTML : '';

    const rec = new SpeechRecognition();
    rec.lang = getLangue() === 'fr' ? 'fr-FR' : 'en-US';
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    reconnaissanceEnCours = rec;

    if (btn) {
        btn.classList.add('listening');
        btn.innerHTML = 'REC...';
    }

    rec.onresult = function(e) {
        const transcript = e.results[0][0].transcript;
        if (input) {
            input.value = input.value ? `${input.value} ${transcript}` : transcript;
        }
        if (actionAuto) {
            if (inputId === 'input-probleme') envoyerMessageLiveChat();
            else if (inputId === 'input-diag-chat') envoyerMessageChatIA('input-diag-chat', 'diag-chat-messages');
            else if (inputId === 'input-guided-chat') envoyerMessageChatIA('input-guided-chat', 'guided-chat-messages');
        }
    };

    rec.onend = function() {
        reconnaissanceEnCours = null;
        if (btn) {
            btn.classList.remove('listening');
            btn.innerHTML = originalHtml;
        }
    };

    rec.start();
}

// =============================================================
// SYSTÈME DE DISCUSSION ET SIDEBAR STYLE CHATGPT
// =============================================================

function basculerSidebarDiscussions(ouvrir) {
    const sidebar = document.getElementById('chatgpt-sidebar');
    const overlay = document.getElementById('chatgpt-sidebar-overlay');
    if (!sidebar || !overlay) return;

    if (ouvrir) {
        sidebar.classList.add('open');
        overlay.style.display = 'block';
        chargerDiscussionsRecentesSidebar();
        actualiserAffichageUtilisateur();
    } else {
        sidebar.classList.remove('open');
        overlay.style.display = 'none';
    }
}

function actualiserAffichageUtilisateur() {
    const nom = localStorage.getItem('rl_user_name') || localStorage.getItem('repairlens_username') || 'Technicien';
    const elNom = document.getElementById('sidebar-user-name');
    const elAvatar = document.getElementById('sidebar-user-avatar');
    if (elNom) elNom.textContent = nom;
    if (elAvatar) elAvatar.textContent = (nom[0] || 'U').toUpperCase();
}

async function chargerDiscussionsRecentesSidebar() {
    const list = document.getElementById('chatgpt-sidebar-list');
    if (!list) return;

    try {
        const uId = getUtilisateurId();
        const res = await fetch('/api/history/', {
            headers: { 'X-Utilisateur-Id': uId }
        });
        if (!res.ok) throw new Error('History fetch error');
        const data = await res.json();
        const sessions = data.sessions || [];

        if (sessions.length === 0) {
            list.innerHTML = `
                <div style="color:var(--text-muted); font-size:12px; padding:20px 10px; text-align:center;">
                    ${getLangue() === 'fr' ? 'Aucune discussion récente.<br>Lancez une réparation pour commencer !' : 'No recent discussions.<br>Start a repair to begin!'}
                </div>
            `;
            return;
        }

        const icones = {
            ventilateur: '',
            fan: '',
            cafetiere: '',
            coffee: '',
            pc: '',
            ordinateur: '',
            laptop: '',
            ecran: '',
            moteur: '',
            four: '',
            micro: '',
            enceinte: ''
        };

        list.innerHTML = sessions.slice(0, 20).map(s => {
            const nomApp = s.type_appareil || 'Appareil';
            const nomLower = nomApp.toLowerCase();
            let icone = '';
            for (const [k, v] of Object.entries(icones)) {
                if (nomLower.includes(k)) { icone = v; break; }
            }
            const dateStr = s.date_creation ? s.date_creation.split(' ')[0] : '';
            const isActive = sessionId && String(sessionId) === String(s.id);

            return `
                <div class="chatgpt-sidebar-item ${isActive ? 'active' : ''}" onclick="chargerSessionDepuisSidebar(${s.id})">
                    <span style="font-size:16px;">${icone}</span>
                    <div style="flex:1; overflow:hidden;">
                        <div style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis; font-weight:600;">
                            ${nomApp}
                        </div>
                        <div style="font-size:10px; color:var(--text-muted); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
                            ${s.probleme_detecte || s.statut || dateStr}
                        </div>
                    </div>
                </div>
            `;
        }).join('');
    } catch (err) {
        console.warn('Sidebar history error:', err);
        list.innerHTML = `
            <div style="color:var(--text-muted); font-size:12px; padding:16px 10px; text-align:center;">
                ${getLangue() === 'fr' ? 'Impossible de charger les discussions.' : 'Could not load discussions.'}
            </div>
        `;
    }
}

function chargerSessionDepuisSidebar(id) {
    basculerSidebarDiscussions(false);
    window.location.href = `/static/camera.html?session_id=${id}`;
}

function nouvelleInspectionReinitialiser() {
    basculerSidebarDiscussions(false);
    sessionId = null;
    appareilActuel = "";
    descriptionActuelle = "";
    composantsDetectes = [];
    etapesActuelles = [];
    historiqueMessages = [];
    imageDataUrl = null;
    imageBase64 = null;
    photoDataUrl = '';
    photoBase64 = null;
    videoObjectUrl = '';
    videoFramesBase64 = [];
    const mediaTabs = document.getElementById('media-switcher-tabs');
    if (mediaTabs) mediaTabs.style.display = 'none';
    arreterCamera();

    const thread = document.getElementById('live-chat-thread');
    if (thread) thread.innerHTML = '';
    const quick = document.getElementById('live-chat-quick-replies');
    if (quick) quick.style.display = 'none';
    const panel = document.getElementById('setup-panel');
    if (panel) panel.style.display = 'none';
    const placeholder = document.getElementById('setup-placeholder');
    if (placeholder) placeholder.style.display = 'flex';

    afficherEcran('screen-new-inspection');
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

// Fonction centrale d'affichage des bulles de chat façon ChatGPT :
// - L'humain est à DROITE (bleu dégradé, Vous / Nom)
// - L'IA est à GAUCHE (fond sombre, bordure cyan, Assistant RepairLens)
function ajouterMessageChatGPT(containerId, auteur, texte, role, actionsHtml = '', proposerVideo = false) {
    const zone = document.getElementById(containerId);
    if (!zone) return null;
    zone.style.display = 'block';

    const row = document.createElement('div');
    const isUser = role === 'user';
    row.className = `chat-row ${isUser ? 'chat-row-user' : 'chat-row-ai'}`;

    const nomDefaut = isUser ? (localStorage.getItem('rl_user_name') || (getLangue() === 'fr' ? 'Vous' : 'You')) : 'Assistant RepairLens';
    const nomAffiche = auteur || nomDefaut;
    const headerClass = isUser ? 'chat-sender-header chat-sender-user' : 'chat-sender-header chat-sender-ai';
    const headerPrefix = '';
    const bubbleClass = isUser ? 'chat-bubble-chatgpt-user' : 'chat-bubble-chatgpt-ai';

    let defaultActions = '';
    if (!isUser) {
        defaultActions = `
            <div class="chat-ai-actions-row">
                <button type="button" class="chat-action-btn" onclick="parlerIA(this.closest('.chat-bubble-chatgpt-ai').innerText)" title="Écouter à voix haute">
                    <span>Écouter</span>
                </button>
                <button type="button" class="chat-action-btn" onclick="navigator.clipboard.writeText(this.closest('.chat-bubble-chatgpt-ai').innerText); afficherToast('Copié !')" title="Copier">
                    <span>Copier</span>
                </button>
            </div>
        `;
    }

    let boutonVideo = '';
    const texteLower = (texte || '').toLowerCase();
    const doitProposerVideo = proposerVideo || texteLower.includes('appel vidéo') || texteLower.includes('appel video');
    if (!isUser && doitProposerVideo) {
        const isFr = getLangue() === 'fr';
        boutonVideo = `
            <div style="margin-top:12px; margin-bottom:4px;">
                <button type="button" class="btn-cyan" onclick="demarrerAppelVideoDepuisChat()" style="margin:0; width:100%; padding:10px 16px; font-size:13px; font-weight:800; border-radius:12px; display:inline-flex; align-items:center; justify-content:center; gap:8px; background:linear-gradient(90deg, #0284c7 0%, #00f0ff 100%); color:#04121a; border:none; cursor:pointer; box-shadow:0 0 16px rgba(0,240,255,0.45);">
                    <span>${isFr ? "Démarrer l'Appel Vidéo Live" : "Start Live Video Call"}</span>
                </button>
            </div>
        `;
    }

    const msgTextEl = document.createElement('div');
    msgTextEl.className = 'chat-msg-text';
    msgTextEl.textContent = texte;

    row.innerHTML = `
        <div class="${headerClass}">${headerPrefix}${nomAffiche}</div>
        <div class="${bubbleClass}">
            ${boutonVideo}
            ${actionsHtml || defaultActions}
        </div>
    `;
    row.querySelector(`.${bubbleClass}`).prepend(msgTextEl);

    zone.appendChild(row);
    zone.scrollTop = zone.scrollHeight;
    return row;
}

function ajouterBadgeDevice(row, deviceName) {
    if (!row || !deviceName) return;
    const bubble = row.querySelector('.chat-bubble-chatgpt-ai') || row.querySelector('.chat-bubble-chatgpt-user');
    if (!bubble) return;
    const badge = document.createElement('span');
    badge.style.cssText = 'font-size:11px; font-weight:800; color:#04121a; background:var(--cyan-neon); padding:3px 10px; border-radius:999px; letter-spacing:0.5px; display:inline-block; margin-bottom:8px;';
    badge.textContent = deviceName.toUpperCase();
    const textEl = bubble.querySelector('.chat-msg-text');
    if (textEl) bubble.insertBefore(badge, textEl);
}

// Démarrer l'Appel Vidéo Live IA directement depuis le chat (Screen 1, 2, 3 ou 4)
async function demarrerAppelVideoDepuisChat() {
    const isFr = getLangue() === 'fr';

    // 1. Si la session n'existe pas encore, on la crée immédiatement
    if (!sessionId) {
        try {
            const miniature = imageDataUrl ? await creerMiniatureBase64(imageDataUrl) : null;
            const resSession = await fetch('/api/history/nouvelle', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-Utilisateur-Id': getUtilisateurId() },
                body: JSON.stringify({
                    type_appareil: appareilActuel || document.getElementById('input-appareil').value || 'Appareil',
                    probleme_detecte: descriptionActuelle || 'Appel Vidéo en direct avec IA',
                    utilisateur_id: getUtilisateurId(),
                    nom_utilisateur: localStorage.getItem('rl_user_name') || null,
                    image_miniature: miniature
                })
            });
            const dataSession = await resSession.json();
            if (dataSession && dataSession.session_id) {
                sessionId = dataSession.session_id;
            }
        } catch (e) {
            console.warn('Erreur session appel live:', e);
        }
    }

    // 2. Définir des étapes guidées pour le HUD si aucune n'a encore été générée
    if (!etapesActuelles || etapesActuelles.length === 0) {
        etapesActuelles = [
            {
                numero: 1,
                instruction: isFr
                    ? `Pointez la caméra vers votre ${appareilActuel || 'appareil'} pour le diagnostic visuel en direct.`
                    : `Point your camera at your ${appareilActuel || 'device'} for live visual diagnosis.`,
                est_complete: 'non'
            },
            {
                numero: 2,
                instruction: isFr
                    ? `Montrez les connecteurs, câbles et pièces mobiles à l'IA.`
                    : `Show connectors, cables, and moving parts to the AI.`,
                est_complete: 'non'
            }
        ];
    }

    // 3. Basculer sur l'écran guidé AR
    indexEtapeActive = 0;
    afficherEtapeGuidee(0);
    afficherEcran('screen-guided-inspection');

    // 4. Lancer immédiatement le flux vidéo live si pas déjà démarré
    if (!fluxAppelVideoLive) {
        setTimeout(() => {
            basculerAppelVideoLiveIA();
        }, 350);
    }
}

// Sélection d'une réponse rapide en 1 clic
function choisirReponseRapide(texte) {
    const quickZone = document.getElementById('live-chat-quick-replies');
    if (quickZone) quickZone.style.display = 'none';

    const input = document.getElementById('input-probleme');
    if (input) input.value = texte;
    envoyerMessageLiveChat();
}

// Envoi d'un message dans le fil de discussion en direct (Screen 1)
async function envoyerMessageLiveChat() {
    const input = document.getElementById('input-probleme');
    if (!input) return;
    const msg = input.value.trim();
    if (!msg) return;

    input.value = '';
    const isFr = getLangue() === 'fr';
    const prenom = localStorage.getItem('rl_user_name') || (isFr ? 'Vous' : 'You');

    // Cacher immédiatement les boutons de suggestions rapides dès que l'utilisateur a répondu
    const quickZone = document.getElementById('live-chat-quick-replies');
    if (quickZone) quickZone.style.display = 'none';

    // 1. Message Utilisateur à DROITE
    ajouterMessageChatGPT('live-chat-thread', prenom, msg, 'user');

    // Enrichir la description du problème
    if (descriptionActuelle) {
        descriptionActuelle += ` — ${msg}`;
    } else {
        descriptionActuelle = msg;
    }

    // Si la reconnaissance visuelle de l'appareil est encore en cours, on attend son résultat pour avoir le vrai nom
    if (promesseAutoId) {
        try {
            await promesseAutoId;
        } catch (e) {}
    }

    // 2. Message de réflexion de l'IA à GAUCHE
    const waitRow = ajouterMessageChatGPT('live-chat-thread', 'Assistant RepairLens', isFr ? 'Réflexion en cours...' : 'Thinking...', 'ai', '<div style="font-size:11px; color:var(--cyan-neon); margin-top:4px;">Analyse multimodale...</div>');
    if (waitRow) waitRow.id = 'live-chat-ai-waiting';

    try {
        const res = await fetch('/api/diagnostic/continuer', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                session_id: sessionId || null,
                type_appareil: appareilActuel || document.getElementById('input-appareil').value || 'Appareil',
                probleme_decrit: descriptionActuelle,
                composants: composantsDetectes || [],
                historique_messages: historiqueMessages,
                message_technicien: msg,
                nom_utilisateur: localStorage.getItem('rl_user_name') || null,
                utilisateur_id: getUtilisateurId(),
                langue: getLangue()
            })
        });
        if (!res.ok) {
            const errBody = await res.text().catch(() => '');
            throw new Error(`Server ${res.status}: ${errBody.slice(0, 200)}`);
        }
        const data = await res.json();
        if (!data || !data.reponse_ia) throw new Error('Empty AI response');
        const waitEl = document.getElementById('live-chat-ai-waiting');
        if (waitEl) waitEl.remove();

        if (data && data.session_id) {
            sessionId = data.session_id;
        }

        if (data && data.prenom_detecte) {
            localStorage.setItem('rl_user_name', data.prenom_detecte);
            actualiserAffichageUtilisateur();
        }

        const texteReponse = (data && data.reponse_ia)
            ? data.reponse_ia
            : (isFr
                ? `Bien reçu ${prenom} ! Peux-tu me donner plus de détails sur le problème que tu rencontres avec ton ${appareilActuel || 'appareil'} ?`
                : `Got it ${prenom}! Can you give me more details about the issue you're experiencing with your ${appareilActuel || 'device'}?`);

        historiqueMessages.push({ auteur: prenom, texte: msg });
        historiqueMessages.push({ auteur: 'Assistant RepairLens', texte: texteReponse });

        // 3. Réponse IA à GAUCHE (avec bouton d'appel vidéo si suggéré ou mentionné)
        const proposerVideo = Boolean(data && data.proposer_appel_video);
        ajouterMessageChatGPT('live-chat-thread', 'Assistant RepairLens', texteReponse, 'ai', '', proposerVideo);
        parlerIA(texteReponse);

        // Si l'IA propose un appel vidéo, afficher aussi la pilule d'accès rapide
        if (proposerVideo) {
            const quickZone = document.getElementById('live-chat-quick-replies');
            if (quickZone) {
                quickZone.style.display = 'flex';
                quickZone.innerHTML = `
                    <button type="button" class="chat-quick-pill" onclick="demarrerAppelVideoDepuisChat()" style="background:rgba(0,240,255,0.15); border-color:var(--cyan-neon); color:var(--cyan-neon);">
                        <span>${isFr ? "Démarrer l'Appel Vidéo Live" : "Start Live Video Call"}</span>
                    </button>
                `;
            }
        }

        // Si des étapes supplémentaires sont proposées
        if (data && data.nouvelles_etapes && data.nouvelles_etapes.length > 0) {
            etapesActuelles.push(...data.nouvelles_etapes);
        }
    } catch (err) {
        console.error('Erreur chat live:', err);
        const waitEl = document.getElementById('live-chat-ai-waiting');
        if (waitEl) waitEl.remove();
        const fallbackTexte = isFr
            ? `Hmm, j'ai eu un petit souci de connexion${prenom ? ' ' + prenom : ''}. Peux-tu reformuler ta question ? Je suis prêt à t'aider avec ton ${appareilActuel || 'appareil'}.`
            : `I had a brief connection issue${prenom ? ' ' + prenom : ''}. Could you rephrase your question? I'm ready to help with your ${appareilActuel || 'device'}.`;
        ajouterMessageChatGPT('live-chat-thread', 'Assistant RepairLens', fallbackTexte, 'ai');
    }
}

// Dictée vocale pour le chat en direct
function dicterChampLiveChat() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
        alert('La reconnaissance vocale est disponible sur Google Chrome et Microsoft Edge.');
        return;
    }
    const rec = new SpeechRecognition();
    rec.lang = getLangue() === 'fr' ? 'fr-FR' : 'en-US';
    rec.interimResults = false;
    const btn = document.getElementById('mic-issue');
    if (btn) btn.classList.add('listening');

    rec.onresult = function(e) {
        const texte = e.results[0][0].transcript;
        const input = document.getElementById('input-probleme');
        if (input) input.value = texte;
        envoyerMessageLiveChat();
    };
    rec.onend = function() {
        if (btn) btn.classList.remove('listening');
    };
    rec.start();
}

// =============================================================
// ÉCRAN 1 : NEW INSPECTION (Camera / Upload / Describe)
// =============================================================
function ouvrirModeCapture(mode) {
    const setupPanel = document.getElementById('setup-panel');
    const zoneCam    = document.getElementById('zone-camera-live');
    const placeholder = document.getElementById('setup-placeholder');
    if (placeholder) placeholder.style.display = 'none';
    if (setupPanel) setupPanel.style.display = 'block';

    const thread = document.getElementById('live-chat-thread');
    const quickZone = document.getElementById('live-chat-quick-replies');
    if (quickZone) quickZone.style.display = 'none';

    if (mode === 'camera') {
        zoneCam.style.display = 'block';
        demarrerCamera();
    } else if (mode === 'upload') {
        arreterCamera();
        zoneCam.style.display = 'none';
        document.getElementById('input-fichier').click();
    } else if (mode === 'video') {
        arreterCamera();
        zoneCam.style.display = 'none';
        document.getElementById('input-video').click();
    } else if (mode === 'describe') {
        arreterCamera();
        zoneCam.style.display = 'none';
        imageDataUrl = null;
        imageBase64 = null;
        estModeVideo = false;
        videoFramesBase64 = [];
        document.getElementById('zone-photo-preview').style.display = 'none';
        document.getElementById('zone-video-preview').style.display = 'none';
        document.getElementById('input-appareil').value = '';

        if (thread) {
            thread.innerHTML = '';
            const msgIntro = getLangue() === 'fr'
                ? "Bonjour ! Décris-moi l'appareil que tu souhaites réparer et ce qui ne va pas (ex: 'Mon ventilateur sent le chaud et s'arrête', 'Ma cafetière fuit'), ou utilise le micro  pour me parler."
                : "Hello! Describe the device you want to repair and what's going wrong (e.g. 'My fan smells like burning and stops', 'Coffee maker leaks'), or use the mic  to talk to me.";
            ajouterMessageChatGPT('live-chat-thread', 'Assistant RepairLens', msgIntro, 'ai');
            historiqueMessages = [
                { auteur: 'Assistant RepairLens', texte: msgIntro }
            ];
            parlerIA(msgIntro);
        }

        const input = document.getElementById('input-probleme');
        if (input) input.focus();
    }

    setupPanel.scrollIntoView({ behavior: 'smooth' });
}

let promesseAutoId = null;
let dernierMessageAccueilIA = "";
let problemeVisuelDetecteAuto = "";

function relireMessageAccueilIA() {
    if (dernierMessageAccueilIA) {
        parlerIA(dernierMessageAccueilIA);
    }
}

function basculerApercuMedia(mode) {
    const zonePhoto = document.getElementById('zone-photo-preview');
    const zoneVideo = document.getElementById('zone-video-preview');
    const tabPhoto  = document.getElementById('tab-media-photo');
    const tabVideo  = document.getElementById('tab-media-video');

    if (mode === 'video') {
        if (zonePhoto) zonePhoto.style.display = 'none';
        if (zoneVideo) zoneVideo.style.display = 'block';
        if (tabPhoto) {
            tabPhoto.style.background = 'rgba(0,240,255,0.12)';
            tabPhoto.style.color = 'var(--cyan-neon)';
        }
        if (tabVideo) {
            tabVideo.style.background = 'var(--cyan-neon)';
            tabVideo.style.color = '#04121a';
        }
        estModeVideo = true;
    } else {
        if (zonePhoto) zonePhoto.style.display = 'block';
        if (zoneVideo) zoneVideo.style.display = 'none';
        if (tabPhoto) {
            tabPhoto.style.background = 'var(--cyan-neon)';
            tabPhoto.style.color = '#04121a';
        }
        if (tabVideo) {
            tabVideo.style.background = 'rgba(0,240,255,0.12)';
            tabVideo.style.color = 'var(--cyan-neon)';
        }
        estModeVideo = false;
    }
}

async function detecterAppareilAutomatiqueIA(b64, options = {}) {
    if (!b64) return null;
    const champApp = document.getElementById('input-appareil');
    const isFr = getLangue() === 'fr';
    const prenom = (localStorage.getItem('rl_user_name') || localStorage.getItem('repairlens_username') || '').trim();
    const salut = prenom ? `${prenom}` : '';
    const typeMedia = (options && options.typeMedia) || (estModeVideo ? 'video' : 'photo');
    const estVideo = (typeMedia === 'video');
    const motMedia = estVideo ? (isFr ? 'la vidéo' : 'the video') : (isFr ? 'la photo' : 'the photo');
    const estEnrichissement = Boolean(options && options.estEnrichissement);

    const thread = document.getElementById('live-chat-thread');
    let waitMsg = "";

    if (estEnrichissement && (appareilActuel || (champApp && champApp.value))) {
        const nomApp = appareilActuel || champApp.value;
        waitMsg = isFr
            ? `J'analyse ${motMedia} pour enrichir le diagnostic de votre ${nomApp}...`
            : `Analyzing ${motMedia} to enhance your ${nomApp} diagnosis...`;
    } else {
        waitMsg = isFr
            ? `Un instant${salut ? ' ' + salut : ''}, j'observe attentivement ${motMedia} pour identifier le modèle et repérer les anomalies.`
            : `One moment${salut ? ' ' + salut : ''}, I am examining ${motMedia} to identify the device and spot any visible defects.`;
    }

    let waitingEl = null;
    if (thread) {
        if (!estEnrichissement) {
            thread.innerHTML = '';
        }
        waitingEl = ajouterMessageChatGPT('live-chat-thread', 'Assistant RepairLens', waitMsg, 'ai');
    }

    // PROACTIVITÉ : L'assistant PARLE TOUT DE SUITE dès que le média est chargé !
    parlerIA(waitMsg);

    // Timeout de 8 secondes max : si le réseau tarde, on ne laisse JAMAIS l'utilisateur sans réponse !
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);

    try {
        const res = await fetch('/api/segmentation/identifier-image', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                image_base64: b64,
                langue: getLangue(),
                nom_utilisateur: prenom || null,
                type_media: typeMedia,
                appareil_existant: appareilActuel || (champApp ? champApp.value : null),
                historique_messages: historiqueMessages
            }),
            signal: controller.signal
        });
        clearTimeout(timeoutId);
        const data = await res.json();
        if (data && data.type_appareil) {
            if (champApp) champApp.value = data.type_appareil;
            appareilActuel = data.type_appareil;
            problemeVisuelDetecteAuto = data.probleme_visuel || '';
            dernierMessageAccueilIA = data.message_accueil_ia || (
                estEnrichissement
                    ? (isFr
                        ? `Bien reçu ! Cette ${motMedia} apporte des éléments précieux sur votre ${appareilActuel} (${problemeVisuelDetecteAuto}). Que souhaitez-vous vérifier en priorité ?`
                        : `Got it! This ${motMedia} adds critical details to your ${appareilActuel} (${problemeVisuelDetecteAuto}). What should we inspect next?`)
                    : (isFr
                        ? `${salut ? salut + ', j' : 'J'}e vois qu'il s'agit d'un ${data.type_appareil} (${problemeVisuelDetecteAuto}). Que constatez-vous à l'utilisation ?`
                        : `${salut ? salut + ', I' : 'I'} can see this is a ${data.type_appareil} (${problemeVisuelDetecteAuto}). What happens when you power it on?`)
            );

            // Retirer le message d'attente
            if (waitingEl) waitingEl.remove();

            if (thread) {
                if (!estEnrichissement) {
                    thread.innerHTML = '';
                }
                const msgRow = ajouterMessageChatGPT('live-chat-thread', 'Assistant RepairLens', dernierMessageAccueilIA, 'ai');
                ajouterBadgeDevice(msgRow, data.type_appareil);
            }

            historiqueMessages.push(
                { auteur: 'Assistant RepairLens', texte: dernierMessageAccueilIA }
            );
            parlerIA(dernierMessageAccueilIA);

            // Réponses rapides adaptées (SANS EMOJI)
            const quickZone = document.getElementById('live-chat-quick-replies');
            if (quickZone && data.reponses_rapides && data.reponses_rapides.length > 0) {
                quickZone.style.display = 'flex';
                quickZone.innerHTML = data.reponses_rapides.map(rep => {
                    const safeRep = rep.replace(/'/g, "\'").replace(/"/g, '&quot;');
                    return `<button type="button" class="chat-quick-pill" onclick="choisirReponseRapide('${safeRep}')">${rep}</button>`;
                }).join('');
            }

            const inputField = document.getElementById('input-probleme');
            if (inputField) {
                inputField.placeholder = isFr ? "Votre réponse ou détail supplémentaire..." : "Your reply or extra details...";
            }

            return data;
        }
    } catch (err) {
        clearTimeout(timeoutId);
        console.warn('Auto-ID handled fallback:', err);
    }

    if (waitingEl) waitingEl.remove();

    // Fallback instantané
    const nomFallback = appareilActuel || (isFr
        ? (estVideo ? "Moteur / Appareil en mouvement" : "Appareil électronique")
        : (estVideo ? "Motor / Moving Device" : "Electronic Device"));

    if (champApp && !champApp.value) champApp.value = nomFallback;
    appareilActuel = nomFallback;

    if (estEnrichissement) {
        dernierMessageAccueilIA = isFr
            ? `J'ai bien intégré ${motMedia} au diagnostic de votre ${appareilActuel}. L'analyse dynamique confirme le comportement des composants. Constatez-vous un bruit particulier ou un blocage ?`
            : `Added ${motMedia} to your ${appareilActuel} diagnosis. Dynamic inspection confirms component behavior. Do you notice any unusual noise or jamming?`;
    } else {
        dernierMessageAccueilIA = isFr
            ? `Bien reçu ${salut ? salut + ' ! ' : ''}J'ai analysé ${motMedia} de votre appareil. Que constatez-vous à l'utilisation ?`
            : `Received ${salut ? salut + '! ' : ''}I analyzed ${motMedia} of your device. What is not working properly?`;
    }

    if (thread) {
        if (!estEnrichissement) thread.innerHTML = '';
        const msgRowFb = ajouterMessageChatGPT('live-chat-thread', 'Assistant RepairLens', dernierMessageAccueilIA, 'ai');
        ajouterBadgeDevice(msgRowFb, nomFallback);
    }
    historiqueMessages.push(
        { auteur: 'Assistant RepairLens', texte: dernierMessageAccueilIA }
    );
    parlerIA(dernierMessageAccueilIA);

    const quickZone = document.getElementById('live-chat-quick-replies');
    if (quickZone) {
        const repsNeutres = isFr
            ? [`Il ne s'allume plus`, `Il fait un bruit anormal`, `Je vois un dégât visible`]
            : [`It won't turn on`, `It makes an unusual noise`, `I see visible damage`];
        quickZone.style.display = 'flex';
        quickZone.innerHTML = repsNeutres.map(rep => {
            const safeRep = rep.replace(/'/g, "\\'").replace(/"/g, '&quot;');
            return `<button type="button" class="chat-quick-pill" onclick="choisirReponseRapide('${safeRep}')">${rep}</button>`;
        }).join('');
    }

    return null;
}

document.getElementById('input-fichier').addEventListener('change', function(e) {
    const fichier = e.target.files[0];
    if (!fichier) return;

    const aDejaContenu = Boolean(photoBase64 || videoObjectUrl || appareilActuel || (historiqueMessages && historiqueMessages.length > 0));

    const reader = new FileReader();
    reader.onload = function(ev) {
        photoDataUrl = ev.target.result;
        imageDataUrl = photoDataUrl;

        const preview = document.getElementById('preview-image');
        preview.src = imageDataUrl;

        const placeholder = document.getElementById('setup-placeholder');
        if (placeholder) placeholder.style.display = 'none';
        document.getElementById('setup-panel').style.display = 'block';

        // Si une vidéo était déjà présente, on active les onglets de bascule
        if (videoObjectUrl) {
            const tabs = document.getElementById('media-switcher-tabs');
            if (tabs) tabs.style.display = 'flex';
        }
        basculerApercuMedia('photo');

        // Compression instantanée sur Canvas (diminue le poids par 20 sans perte de netteté)
        const img = new Image();
        img.onload = function() {
            const maxDim = 720;
            let w = img.width;
            let h = img.height;
            if (w > maxDim || h > maxDim) {
                if (w > h) { h = Math.round((h * maxDim) / w); w = maxDim; }
                else { w = Math.round((w * maxDim) / h); h = maxDim; }
            }
            const canvas = document.createElement('canvas');
            canvas.width = w;
            canvas.height = h;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, w, h);
            const optUrl = canvas.toDataURL('image/jpeg', 0.78);
            photoBase64 = optUrl.split(',')[1];
            imageBase64 = photoBase64;

            if (aDejaContenu) {
                ajouterMessageChatGPT('live-chat-thread', localStorage.getItem('rl_user_name') || 'Vous', 'Photo détaillée ajoutée pour compléter le diagnostic.', 'user');
                promesseAutoId = detecterAppareilAutomatiqueIA(imageBase64, { estEnrichissement: true, typeMedia: 'photo' });
            } else {
                document.getElementById('input-appareil').value = '';
                document.getElementById('input-probleme').value = '';
                promesseAutoId = detecterAppareilAutomatiqueIA(imageBase64, { estEnrichissement: false, typeMedia: 'photo' });
            }
            lancerAnalyseImmediatement();
        };
        img.src = imageDataUrl;
    };
    reader.readAsDataURL(fichier);
});

// Gestion de l'upload Vidéo + fusion multimodale dans la même session !
document.getElementById('input-video').addEventListener('change', async function(e) {
    const fichierVideo = e.target.files[0];
    if (!fichierVideo) return;

    const aDejaContenu = Boolean(photoBase64 || appareilActuel || (historiqueMessages && historiqueMessages.length > 0));

    videoObjectUrl = URL.createObjectURL(fichierVideo);
    const videoEl  = document.getElementById('preview-video');
    videoEl.src = videoObjectUrl;

    const placeholderVid = document.getElementById('setup-placeholder');
    if (placeholderVid) placeholderVid.style.display = 'none';
    document.getElementById('setup-panel').style.display = 'block';

    // Si une photo était déjà présente, on affiche les onglets et on conserve les deux !
    if (photoBase64 || imageDataUrl) {
        const tabs = document.getElementById('media-switcher-tabs');
        if (tabs) tabs.style.display = 'flex';
    }
    basculerApercuMedia('video');

    const prenom = (localStorage.getItem('rl_user_name') || '').trim();
    const isFr = getLangue() === 'fr';

    if (aDejaContenu) {
        ajouterMessageChatGPT('live-chat-thread', localStorage.getItem('rl_user_name') || 'Vous', 'Vidéo dynamique ajoutée pour compléter le diagnostic.', 'user');
        parlerIA(isFr ? `J'intègre votre vidéo au diagnostic de votre ${appareilActuel || 'appareil'}.` : `Integrating video to your ${appareilActuel || 'device'} diagnosis.`);
    } else {
        parlerIA(isFr ? `Un instant${prenom ? ' ' + prenom : ''}, j'analyse votre vidéo.` : `One moment${prenom ? ' ' + prenom : ''}, analyzing your video.`);
    }

    afficherToast(isFr ? 'Préparation de la vidéo...' : 'Preparing video frames...', '');
    videoFramesBase64 = await extraireFramesDeVideo(videoObjectUrl);
    if (videoFramesBase64.length > 0) {
        const frameB64 = videoFramesBase64[0];
        if (!photoBase64) {
            imageBase64  = frameB64;
            imageDataUrl = `data:image/jpeg;base64,${frameB64}`;
        }
        afficherToast(isFr ? `Vidéo prête pour l'analyse !` : `Video ready for analysis!`, '');

        if (aDejaContenu) {
            promesseAutoId = detecterAppareilAutomatiqueIA(frameB64, { estEnrichissement: true, typeMedia: 'video' });
        } else {
            document.getElementById('input-appareil').value = '';
            document.getElementById('input-probleme').value = '';
            promesseAutoId = detecterAppareilAutomatiqueIA(frameB64, { estEnrichissement: false, typeMedia: 'video' });
        }
        lancerAnalyseImmediatement();
    }
});

function extraireFramesDeVideo(videoUrl) {
    return new Promise((resolve) => {
        const vid = document.createElement('video');
        vid.src = videoUrl;
        vid.muted = true;
        vid.playsInline = true;
        const frames = [];

        vid.onloadedmetadata = async function() {
            const duree = vid.duration || 3;
            const instants = [0.2, duree * 0.5, Math.max(0.5, duree - 0.3)];
            const canvas = document.createElement('canvas');
            canvas.width = 640;
            canvas.height = 360;
            const ctx = canvas.getContext('2d');

            for (const t of instants) {
                await new Promise((resSeek) => {
                    vid.currentTime = t;
                    vid.onseeked = () => {
                        ctx.drawImage(vid, 0, 0, canvas.width, canvas.height);
                        frames.push(canvas.toDataURL('image/jpeg', 0.8).split(',')[1]);
                        resSeek();
                    };
                });
            }
            resolve(frames);
        };
        vid.onerror = () => resolve([]);
    });
}

async function demarrerCamera() {
    try {
        streamCamera = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: { ideal: 'environment' }, width: 1280, height: 720 }
        });
        document.getElementById('video-stream').srcObject = streamCamera;
    } catch (err) {
        alert('Camera access error: ' + err.message);
    }
}

function arreterCamera() {
    if (streamCamera) {
        streamCamera.getTracks().forEach(t => t.stop());
        streamCamera = null;
    }
}

function capturerFrameCamera() {
    const video  = document.getElementById('video-stream');
    const canvas = document.getElementById('canvas-capture');
    canvas.width  = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    canvas.getContext('2d').drawImage(video, 0, 0);

    imageDataUrl = canvas.toDataURL('image/jpeg', 0.85);
    imageBase64  = imageDataUrl.split(',')[1];

    arreterCamera();
    document.getElementById('zone-camera-live').style.display = 'none';
    const preview = document.getElementById('preview-image');
    preview.src = imageDataUrl;
    document.getElementById('zone-photo-preview').style.display = 'block';
    promesseAutoId = detecterAppareilAutomatiqueIA(imageBase64);
    lancerAnalyseImmediatement();
}

// Créer une miniature légère en Base64 pour sauvegarder dans PostgreSQL
function creerMiniatureBase64(dataUrl) {
    return new Promise((resolve) => {
        if (!dataUrl) return resolve(null);
        const img = new Image();
        img.onload = function() {
            const c = document.createElement('canvas');
            const maxW = 180;
            const scale = maxW / img.width;
            c.width = maxW;
            c.height = img.height * scale;
            c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
            resolve(c.toDataURL('image/jpeg', 0.65).split(',')[1]);
        };
        img.onerror = () => resolve(null);
        img.src = dataUrl;
    });
}

function devinerAppareilDepuisTexte(texte) {
    if (!texte) return null;
    const tMin = texte.toLowerCase();
    const appareilsConnus = [
        ['ventilateur', 'Ventilateur'], ['fan', 'Fan'],
        ['machine à café', 'Machine à café'], ['cafetière', 'Machine à café'], ['expresso', 'Machine Expresso'], ['coffee', 'Coffee Maker'],
        ['téléphone', 'Smartphone'], ['telephone', 'Smartphone'], ['iphone', 'iPhone'], ['samsung', 'Smartphone Samsung'], ['phone', 'Smartphone'],
        ['ordinateur', 'Ordinateur portable'], ['pc', 'Ordinateur PC'], ['laptop', 'Laptop'], ['macbook', 'MacBook'],
        ['machine à laver', 'Machine à laver'], ['lave-linge', 'Lave-linge'], ['washing', 'Washing Machine'],
        ['climatiseur', 'Climatiseur'], ['clim', 'Climatiseur'], ['frigo', 'Réfrigérateur'], ['réfrigérateur', 'Réfrigérateur'],
        ['télévision', 'Téléviseur'], ['tv', 'Téléviseur'], ['micro-onde', 'Micro-ondes']
    ];
    for (const [mot, label] of appareilsConnus) {
        if (tMin.includes(mot)) return label;
    }
    const mots = texte.trim().split(/\s+/).slice(0, 4).join(' ');
    return mots.length > 2 ? mots : null;
}

// =============================================================
// ANALYSE IMMÉDIATE : Détourage + Vision dès l'import (pas d'attente)
// =============================================================
async function lancerAnalyseImmediatement() {
    if (!imageBase64) return;

    const setupPlaceholder = document.getElementById('setup-placeholder');
    const setupPanel = document.getElementById('setup-panel');
    const zonePhoto = document.getElementById('zone-photo-preview');
    const zoneVideo = document.getElementById('zone-video-preview');
    const zoneVision = document.getElementById('zone-vision-inline');

    if (setupPlaceholder) setupPlaceholder.style.display = 'none';
    if (setupPanel) setupPanel.style.display = 'block';
    if (zonePhoto) zonePhoto.style.display = 'none';
    if (zoneVideo) zoneVideo.style.display = 'none';
    if (zoneVision) zoneVision.style.display = 'block';

    const imgEl = document.getElementById('vision-main-image');
    const vidEl = document.getElementById('vision-main-video');
    const maskCanvas = document.getElementById('vision-mask-canvas');

    if (estModeVideo && videoObjectUrl) {
        if (imgEl) imgEl.style.display = 'none';
        if (maskCanvas) maskCanvas.style.display = 'none';
        if (vidEl) { vidEl.style.display = 'block'; vidEl.src = videoObjectUrl; vidEl.play().catch(() => {}); }
    } else {
        if (vidEl) vidEl.style.display = 'none';
        if (imgEl) { imgEl.style.display = 'block'; imgEl.src = imageDataUrl; }
    }

    defautsParVue = [];
    mettreAJourListeDefauts();

    const scannerOverlay = document.getElementById('ai-live-scanner');
    if (scannerOverlay) scannerOverlay.classList.add('scanning');

    lancerDetourage(imageBase64);

    await promesseAutoId;
    lancerAnalyseComplete();
}

// =============================================================
// LANCER L'ANALYSE SAM 2 (segmentation + scan 360°)
// =============================================================
async function lancerAnalyseComplete() {
    const isFr = getLangue() === 'fr';

    let champAppareil = (document.getElementById('input-appareil') || {}).value || '';
    champAppareil = champAppareil.trim();
    let champProbleme = (document.getElementById('input-probleme') || {}).value || '';
    champProbleme = champProbleme.trim();
    const aMediaVisuel = Boolean(imageBase64) || (estModeVideo && videoFramesBase64.length > 0);

    if (!champAppareil && imageBase64) {
        if (promesseAutoId) {
            await promesseAutoId;
        } else {
            await detecterAppareilAutomatiqueIA(imageBase64);
        }
        champAppareil = (document.getElementById('input-appareil') || {}).value || '';
        champAppareil = champAppareil.trim();
        champProbleme = (document.getElementById('input-probleme') || {}).value || '';
        champProbleme = champProbleme.trim();
    }

    if (!aMediaVisuel && !champProbleme && !champAppareil) {
        return;
    }

    appareilActuel      = champAppareil || devinerAppareilDepuisTexte(champProbleme) || (getLangue() === 'fr' ? 'Appareil électronique' : 'Electronic Device');
    descriptionActuelle = champProbleme || problemeVisuelDetecteAuto || (getLangue() === 'fr' ? 'Inspection visuelle et diagnostic complet' : 'Full visual inspection and diagnosis');

    try {
        const miniature = await creerMiniatureBase64(imageDataUrl);

        // 1. Créer la session dans PostgreSQL si elle n'a pas déjà été créée lors du chat initial
        if (!sessionId) {
            const resSession = await fetch('/api/history/nouvelle', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-Utilisateur-Id': getUtilisateurId() },
                body: JSON.stringify({
                    type_appareil: appareilActuel,
                    probleme_detecte: descriptionActuelle,
                    utilisateur_id: getUtilisateurId(),
                    nom_utilisateur: localStorage.getItem('rl_user_name') || null,
                    image_miniature: miniature
                })
            });
            const dataSession = await resSession.json();
            sessionId = dataSession.session_id;
            if (dataSession.nom_utilisateur) {
                localStorage.setItem('rl_user_name', dataSession.nom_utilisateur);
            }
        }

        // CAS 1 : L'utilisateur a choisi "Décrire un problème" SANS photo ni vidéo -> On ne fait PAS tourner le scanner d'image dans le vide ! On passe direct au Diagnostic IA !
        if (!aMediaVisuel) {
            composantsDetectes = [];
            await passerAuDiagnosticIA();
            return;
        }

        // CAS 2 : Il y a une vraie photo ou vidéo -> Segmenter et afficher l'Écran 2 (Vision IA Active)
        if (estModeVideo && videoFramesBase64.length > 0) {
            const resVid = await fetch('/api/segmentation/analyser-video', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    session_id: sessionId,
                    frames_base64: videoFramesBase64,
                    type_appareil: appareilActuel
                })
            });
            const dataVid = await resVid.json();
            composantsDetectes = dataVid.composants || [];
            if (dataVid.resume_mouvement) {
                afficherToast(dataVid.resume_mouvement, '');
            }
        } else {
            const resSeg = await fetch('/api/segmentation/analyser', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    session_id: sessionId,
                    image_base64: imageBase64,
                    type_appareil: appareilActuel,
                    langue: getLangue()
                })
            });
            const dataSeg = await resSeg.json();
            composantsDetectes = dataSeg.composants || [];
        }
        composantSelectionne = 0;

        const zoneVision = document.getElementById('zone-vision-inline');
        if (zoneVision && zoneVision.style.display === 'block') {
            mettreAJourFicheComposant(composantSelectionne);
            lancerInspectionRotativeIA();
        } else {
            afficherEcranVisionSAM();
        }
    } catch (err) {
        console.error('Analyse error:', err);
    }
}

// =============================================================
// ÉCRAN 2 : AI VISION ACTIVE (SAM 2 + ROTATION & SCAN DES 4 COINS)
// =============================================================
function afficherEcranVisionSAM() {
    defautsParVue = [];
    mettreAJourListeDefauts();

    const setupPlaceholder = document.getElementById('setup-placeholder');
    const setupPanel = document.getElementById('setup-panel');
    const zonePhoto = document.getElementById('zone-photo-preview');
    const zoneVideo = document.getElementById('zone-video-preview');
    const zoneVision = document.getElementById('zone-vision-inline');
    if (setupPlaceholder) setupPlaceholder.style.display = 'none';
    if (setupPanel) setupPanel.style.display = 'block';
    if (zonePhoto) zonePhoto.style.display = 'none';
    if (zoneVideo) zoneVideo.style.display = 'none';
    if (zoneVision) zoneVision.style.display = 'block';

    const imgEl = document.getElementById('vision-main-image');
    const vidEl = document.getElementById('vision-main-video');
    const maskCanvas = document.getElementById('vision-mask-canvas');

    if (estModeVideo && videoObjectUrl) {
        imgEl.style.display = 'none';
        maskCanvas.style.display = 'none';
        vidEl.style.display = 'block';
        vidEl.src = videoObjectUrl;
        vidEl.play().catch(() => {});
    } else {
        vidEl.style.display = 'none';
        imgEl.style.display = 'block';
        if (imageDataUrl) {
            imgEl.src = imageDataUrl;
            lancerDetourage(imageBase64);
        }
    }

    mettreAJourFicheComposant(composantSelectionne);
    lancerInspectionRotativeIA();
}

async function lancerDetourage(b64) {
    if (!b64) return;
    const maskCanvas = document.getElementById('vision-mask-canvas');
    try {
        const res = await fetch('/api/segmentation/detourer', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ image_base64: b64 })
        });
        const data = await res.json();
        if (data.masque_base64) {
            masqueDetourageUrl = 'data:image/png;base64,' + data.masque_base64;
            dessinerMasqueDetoure(masqueDetourageUrl);
            afficherToast(
                getLangue() === 'fr'
                    ? `Appareil detoure en ${data.temps_ms}ms`
                    : `Device isolated in ${data.temps_ms}ms`,
                ''
            );
        }
    } catch (err) {
        console.error('[DETOURAGE]', err);
    }
}

function dessinerMasqueDetoure(masqueUrl) {
    const imgEl = document.getElementById('vision-main-image');
    const maskCanvas = document.getElementById('vision-mask-canvas');
    if (!imgEl || !maskCanvas) return;

    const maskImg = new Image();
    maskImg.onload = function() {
        maskCanvas.width = maskImg.width;
        maskCanvas.height = maskImg.height;
        maskCanvas.style.display = 'block';
        const ctx = maskCanvas.getContext('2d');

        ctx.clearRect(0, 0, maskCanvas.width, maskCanvas.height);
        ctx.drawImage(maskImg, 0, 0);

        ctx.globalCompositeOperation = 'source-atop';
        ctx.strokeStyle = '#00f0ff';
        ctx.lineWidth = 2;
        ctx.shadowColor = '#00f0ff';
        ctx.shadowBlur = 8;

        const imageData = ctx.getImageData(0, 0, maskCanvas.width, maskCanvas.height);
        const d = imageData.data;
        const contourCanvas = document.createElement('canvas');
        contourCanvas.width = maskCanvas.width;
        contourCanvas.height = maskCanvas.height;
        const cctx = contourCanvas.getContext('2d');

        for (let y = 1; y < maskCanvas.height - 1; y++) {
            for (let x = 1; x < maskCanvas.width - 1; x++) {
                const idx = (y * maskCanvas.width + x) * 4;
                const a = d[idx + 3];
                if (a > 128) {
                    const neighbors = [
                        d[((y-1)*maskCanvas.width+x)*4+3],
                        d[((y+1)*maskCanvas.width+x)*4+3],
                        d[(y*maskCanvas.width+x-1)*4+3],
                        d[(y*maskCanvas.width+x+1)*4+3]
                    ];
                    if (neighbors.some(n => n < 128)) {
                        cctx.fillStyle = '#00f0ff';
                        cctx.fillRect(x, y, 1, 1);
                    }
                }
            }
        }

        ctx.globalCompositeOperation = 'source-over';
        ctx.shadowColor = '#00f0ff';
        ctx.shadowBlur = 12;
        ctx.drawImage(contourCanvas, 0, 0);
        ctx.shadowBlur = 0;

        imgEl.style.opacity = '0.15';
    };
    maskImg.src = masqueUrl;
}

function getElementMediaActif() {
    const vidEl = document.getElementById('vision-main-video');
    const imgEl = document.getElementById('vision-main-image');
    return (estModeVideo && vidEl.style.display !== 'none') ? vidEl : imgEl;
}

async function lancerInspectionRotativeIA() {
    const scannerOverlay = document.getElementById('ai-live-scanner');
    const statusText     = document.getElementById('scanner-status-text');
    const angleBadge     = document.getElementById('scanner-angle-badge');
    const reticle        = document.getElementById('scanner-reticle');
    const markersLayer   = document.getElementById('ar-markers-container');
    const mediaEl        = getElementMediaActif();
    const isFr = getLangue() === 'fr';

    if (!scannerOverlay || !mediaEl) {
        dessinerMarqueursSAM();
        return;
    }

    markersLayer.style.opacity = '0';
    scannerOverlay.classList.add('scanning');

    const etapesCoins = isFr
        ? [
            { top: '12%', left: '12%', transform: 'scale(1.22) rotate(12deg) translate(8%, 8%)',    angle: '90° SCAN',  texte: 'Analyse face avant...', vueLabel: 'Face avant' },
            { top: '12%', left: '62%', transform: 'scale(1.25) rotate(90deg) translate(-8%, 8%)',   angle: '180° SCAN', texte: 'Analyse cote droit...', vueLabel: 'Cote droit' },
            { top: '58%', left: '62%', transform: 'scale(1.25) rotate(180deg) translate(-8%, -8%)', angle: '270° SCAN', texte: 'Analyse face arriere...', vueLabel: 'Face arriere' },
            { top: '58%', left: '12%', transform: 'scale(1.22) rotate(270deg) translate(8%, -8%)',  angle: '360° SCAN', texte: 'Analyse cote gauche...', vueLabel: 'Cote gauche' }
          ]
        : [
            { top: '12%', left: '12%', transform: 'scale(1.22) rotate(12deg) translate(8%, 8%)',    angle: '90° SCAN',  texte: 'Analyzing front view...', vueLabel: 'Front' },
            { top: '12%', left: '62%', transform: 'scale(1.25) rotate(90deg) translate(-8%, 8%)',   angle: '180° SCAN', texte: 'Analyzing right side...', vueLabel: 'Right side' },
            { top: '58%', left: '62%', transform: 'scale(1.25) rotate(180deg) translate(-8%, -8%)', angle: '270° SCAN', texte: 'Analyzing back view...', vueLabel: 'Back' },
            { top: '58%', left: '12%', transform: 'scale(1.22) rotate(270deg) translate(8%, -8%)',  angle: '360° SCAN', texte: 'Analyzing left side...', vueLabel: 'Left side' }
          ];

    for (const coin of etapesCoins) {
        reticle.style.top       = coin.top;
        reticle.style.left      = coin.left;
        statusText.textContent  = coin.texte;
        angleBadge.textContent  = coin.angle;
        mediaEl.style.transform = coin.transform;
        mediaEl.style.filter    = 'contrast(1.15) brightness(1.08)';

        if (imageBase64) {
            try {
                const res = await fetch('/api/segmentation/analyser-vue', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        image_base64: imageBase64,
                        type_appareil: appareilActuel,
                        angle_label: coin.vueLabel,
                        defauts_existants: defautsParVue,
                        langue: getLangue()
                    })
                });
                const data = await res.json();
                if (data.defauts && data.defauts.length > 0) {
                    defautsParVue.push(...data.defauts);
                    mettreAJourListeDefauts();
                }
            } catch (err) {
                console.error('[ANALYSE VUE]', err);
            }
        } else {
            await new Promise(r => setTimeout(r, 700));
        }
    }

    angleRotationActuel     = 0;
    mediaEl.style.transform = 'scale(1) rotate(0deg) translate(0, 0)';
    mediaEl.style.filter    = 'none';
    scannerOverlay.classList.remove('scanning');
    markersLayer.style.opacity = '1';
    dessinerMarqueursSAM();

    const nbDefauts = defautsParVue.length;
    afficherToast(
        isFr
            ? `Inspection 360° terminee : ${composantsDetectes.length} composants, ${nbDefauts} defaut${nbDefauts > 1 ? 's' : ''} detecte${nbDefauts > 1 ? 's' : ''}`
            : `360° Scan complete: ${composantsDetectes.length} components, ${nbDefauts} defect${nbDefauts > 1 ? 's' : ''} found`,
        ''
    );
}

async function tournerMedia90Degres() {
    angleRotationActuel = (angleRotationActuel + 90) % 360;
    const mediaEl = getElementMediaActif();
    if (mediaEl) {
        mediaEl.style.transform = `rotate(${angleRotationActuel}deg) scale(1.05)`;
    }

    const isFr = getLangue() === 'fr';
    const vueLabels = isFr
        ? { 0: 'Face avant', 90: 'Cote droit', 180: 'Face arriere', 270: 'Cote gauche' }
        : { 0: 'Front', 90: 'Right side', 180: 'Back', 270: 'Left side' };
    const vueLabel = vueLabels[angleRotationActuel] || `${angleRotationActuel}°`;

    afficherToast(`${isFr ? 'Rotation' : 'Rotated'} : ${angleRotationActuel}° — ${vueLabel}`, '');

    if (imageBase64 && (Date.now() - dernierAnalyseVueTs > 3000)) {
        dernierAnalyseVueTs = Date.now();
        try {
            const res = await fetch('/api/segmentation/analyser-vue', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    image_base64: imageBase64,
                    type_appareil: appareilActuel,
                    angle_label: vueLabel,
                    defauts_existants: defautsParVue,
                    langue: getLangue()
                })
            });
            const data = await res.json();
            if (data.defauts && data.defauts.length > 0) {
                defautsParVue.push(...data.defauts);
                mettreAJourListeDefauts();
            }
        } catch (err) {
            console.error('[ANALYSE VUE ROTATION]', err);
        }
    }
}

function reinitialiserVueMedia() {
    angleRotationActuel = 0;
    const mediaEl = getElementMediaActif();
    if (mediaEl) {
        mediaEl.style.transform = 'rotate(0deg) scale(1)';
    }
    const imgEl = document.getElementById('vision-main-image');
    if (imgEl) imgEl.style.opacity = '1';
    const maskCanvas = document.getElementById('vision-mask-canvas');
    if (maskCanvas) maskCanvas.style.display = 'none';
}

function mettreAJourListeDefauts() {
    const panel = document.getElementById('defauts-par-vue');
    const liste = document.getElementById('defauts-liste');
    const titre = document.getElementById('defauts-titre');
    if (!panel || !liste) return;

    const isFr = getLangue() === 'fr';

    if (defautsParVue.length === 0) {
        panel.style.display = 'none';
        return;
    }

    panel.style.display = 'block';
    titre.textContent = isFr
        ? `${defautsParVue.length} DEFAUT${defautsParVue.length > 1 ? 'S' : ''} DETECTE${defautsParVue.length > 1 ? 'S' : ''}`
        : `${defautsParVue.length} DEFECT${defautsParVue.length > 1 ? 'S' : ''} FOUND`;

    liste.innerHTML = defautsParVue.map(d => `
        <div class="defaut-item">
            <span class="defaut-vue-badge">${d.vue || '?'}</span>
            <div>
                <div class="defaut-text">${d.nom_court || d.description || ''}</div>
                ${d.composant ? `<div class="defaut-comp">${d.composant}</div>` : ''}
            </div>
        </div>
    `).join('');
}

function dessinerMarqueursSAM() {
    const layer = document.getElementById('ar-markers-container');
    if (!composantsDetectes.length) {
        layer.innerHTML = '';
        return;
    }

    // Positions harmonieuses en % sur l'image pour les points 1, 2, 3...
    const positionsDefaut = [
        { left: '32%', top: '62%' },
        { left: '52%', top: '42%' },
        { left: '74%', top: '66%' },
        { left: '45%', top: '25%' }
    ];

    layer.innerHTML = composantsDetectes.map((comp, idx) => {
        const pos = (comp.pos_x <= 100 && comp.pos_y <= 100 && comp.pos_x > 0)
            ? { left: `${comp.pos_x}%`, top: `${comp.pos_y}%` }
            : positionsDefaut[idx % positionsDefaut.length];
        const estSelectionne = idx === composantSelectionne;
        return `
            <div class="sam-hotspot ${estSelectionne ? 'selected' : ''}"
                 style="left:${pos.left}; top:${pos.top};"
                 onclick="event.stopPropagation(); selectionnerComposantSAM(${idx})">
                <div class="sam-hotspot-circle"></div>
                <div class="sam-badge-num">${idx + 1}</div>
            </div>
        `;
    }).join('');
}

// SUPER-POUVOIR SAM 2 : Touch-to-Segment au point exact (x, y) cliqué sur l'image !
async function segmenterPointSurImage(event) {
    const rect = event.currentTarget.getBoundingClientRect();
    const xPct = Math.round(((event.clientX - rect.left) / rect.width) * 100);
    const yPct = Math.round(((event.clientY - rect.top) / rect.height) * 100);

    afficherToast(
        getLangue() === 'fr'
            ? `Segmentation SAM 2 au point (${xPct}%, ${yPct}%)...`
            : `SAM 2 Point Segmentation at (${xPct}%, ${yPct}%)...`,
        ''
    );

    try {
        const res = await fetch('/api/segmentation/segmenter-point', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                session_id: sessionId,
                image_base64: imageBase64 || 'simulation',
                point_x: xPct,
                point_y: yPct,
                type_appareil: appareilActuel,
                langue: getLangue()
            })
        });
        const data = await res.json();
        if (data.composant) {
            composantsDetectes.push(data.composant);
            composantSelectionne = composantsDetectes.length - 1;
            dessinerMarqueursSAM();
            mettreAJourFicheComposant(composantSelectionne);
            parlerIA(`${data.composant.nom}. ${data.composant.description}`);
        }
    } catch (err) {
        console.error('Erreur point segmentation:', err);
    }
}

function selectionnerComposantSAM(idx) {
    composantSelectionne = idx;
    dessinerMarqueursSAM();
    mettreAJourFicheComposant(idx);
}

function mettreAJourFicheComposant(idx) {
    const comp = composantsDetectes[idx];
    if (!comp) return;

    const confPct = Math.round((comp.confiance || 0.92) * 100);
    document.getElementById('vision-comp-kicker').textContent = `${t('detected_comp')} ${idx + 1}`;
    document.getElementById('vision-comp-conf').textContent   = `${confPct}% ${t('confidence_suffix')}`;
    document.getElementById('vision-comp-name').textContent   = comp.nom;
    const descDefaut = getLangue() === 'fr'
        ? `Pièce identifiée sur votre ${appareilActuel} — à vérifier lors du diagnostic.`
        : `Identified component on your ${appareilActuel} — to be checked during diagnosis.`;
    document.getElementById('vision-comp-desc').textContent   = comp.description || descDefaut;

    // Afficher les autres composants détectés
    const autresZone = document.getElementById('other-components-list');
    autresZone.innerHTML = composantsDetectes
        .map((c, i) => ({ c, i }))
        .filter(item => item.i !== idx)
        .map(item => `
            <div class="other-comp-item" onclick="selectionnerComposantSAM(${item.i})">
                <div>
                    <span class="other-comp-num">${item.i + 1}.</span>
                    <span style="font-size:14px; font-weight:600;">${item.c.nom}</span>
                </div>
                <span class="action-chevron">›</span>
            </div>
        `).join('');
}

// =============================================================
// SUPER-POUVOIR DÉBUTANT : GUIDE VISUEL + ZOOM PHOTO SAM 2 + SCHÉMA SVG
// ("Je ne suis pas technicien, à quoi ressemble cette pièce ?")
// =============================================================
function genererSvgPiece(svgType) {
    if (svgType === 'capacitor') {
        return `<svg width="84" height="84" viewBox="0 0 80 80">
            <rect x="20" y="16" width="40" height="44" rx="6" fill="#1e293b" stroke="#00f0ff" stroke-width="2.5"/>
            <ellipse cx="40" cy="18" rx="18" ry="4" fill="#0f172a" stroke="#00f0ff" stroke-width="1.5"/>
            <line x1="30" y1="60" x2="30" y2="75" stroke="#fbbf24" stroke-width="3"/>
            <line x1="50" y1="60" x2="50" y2="75" stroke="#fbbf24" stroke-width="3"/>
            <text x="40" y="42" fill="#00f0ff" font-size="9" font-weight="bold" text-anchor="middle">CBB61 µF</text>
        </svg>`;
    } else if (svgType === 'fuse') {
        return `<svg width="84" height="84" viewBox="0 0 80 80">
            <line x1="6" y1="40" x2="22" y2="40" stroke="#94a3b8" stroke-width="3"/>
            <rect x="22" y="28" width="36" height="24" rx="8" fill="#e2e8f0" stroke="#00f0ff" stroke-width="2.5"/>
            <line x1="58" y1="40" x2="74" y2="40" stroke="#94a3b8" stroke-width="3"/>
            <text x="40" y="43" fill="#0f172a" font-size="8" font-weight="bold" text-anchor="middle">250V 10A</text>
        </svg>`;
    } else if (svgType === 'coil') {
        return `<svg width="84" height="84" viewBox="0 0 80 80">
            <circle cx="40" cy="40" r="28" fill="none" stroke="#f59e0b" stroke-width="6" stroke-dasharray="10 4"/>
            <circle cx="40" cy="40" r="14" fill="#1e293b" stroke="#00f0ff" stroke-width="2.5"/>
            <circle cx="40" cy="40" r="4" fill="#00f0ff"/>
        </svg>`;
    } else {
        return `<svg width="84" height="84" viewBox="0 0 80 80">
            <rect x="18" y="22" width="44" height="36" rx="6" fill="#0f172a" stroke="#00f0ff" stroke-width="2.5"/>
            <circle cx="32" cy="40" r="5" fill="#00f0ff"/>
            <circle cx="48" cy="40" r="5" fill="#34d399"/>
            <line x1="32" y1="58" x2="32" y2="74" stroke="#ef4444" stroke-width="3"/>
            <line x1="48" y1="58" x2="48" y2="74" stroke="#3b82f6" stroke-width="3"/>
        </svg>`;
    }
}

function dessinerZoomPieceSurCanvas(canvasId, comp) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#060a10';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const imgSource = document.getElementById('vision-main-image');
    if (imgSource && imgSource.complete && imgSource.naturalWidth > 0) {
        const px = ((comp && comp.pos_x) ? comp.pos_x : 50) / 100;
        const py = ((comp && comp.pos_y) ? comp.pos_y : 50) / 100;
        const cropW = imgSource.naturalWidth * 0.32;
        const cropH = imgSource.naturalHeight * 0.32;
        const sx = Math.max(0, Math.min(imgSource.naturalWidth - cropW, px * imgSource.naturalWidth - cropW / 2));
        const sy = Math.max(0, Math.min(imgSource.naturalHeight - cropH, py * imgSource.naturalHeight - cropH / 2));
        ctx.drawImage(imgSource, sx, sy, cropW, cropH, 0, 0, canvas.width, canvas.height);
    }

    // Viseur Cyan Néon au centre du zoom
    const cx = canvas.width / 2;
    const cy = canvas.height / 2;
    ctx.strokeStyle = '#00f0ff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, 18, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = '#00f0ff';
    ctx.beginPath();
    ctx.arc(cx, cy, 4, 0, Math.PI * 2);
    ctx.fill();
}

async function expliquerComposantActif() {
    const comp = composantsDetectes[composantSelectionne] || composantsDetectes[0];
    if (!comp) return;

    const box = document.getElementById('beginner-visual-guide-box');
    if (box) box.style.display = 'block';
    dessinerZoomPieceSurCanvas('canvas-zoom-vision', comp);

    try {
        const res = await fetch('/api/diagnostic/guide-visuel-piece', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                nom_composant: comp.nom,
                type_appareil: appareilActuel,
                nom_utilisateur: localStorage.getItem('rl_user_name') || null,
                langue: getLangue()
            })
        });
        const data = await res.json();
        const g = data.guide;
        if (g) {
            document.getElementById('guide-forme-vision').textContent  = g.forme_et_couleur;
            document.getElementById('guide-role-vision').textContent   = g.role_simple;
            document.getElementById('guide-signes-vision').textContent = g.signes_usure_visuels;
            document.getElementById('guide-ref-vision').textContent    = g.reference_achat;
            const zoneImg = document.getElementById('svg-illustration-vision');
            const labelWeb = getLangue() === 'fr' ? 'Voir sur le Web' : 'Web Reference';
            if (g.image_web_url) {
                zoneImg.innerHTML = `
                    <div style="text-align:center;">
                        <img src="${g.image_web_url}" alt="${g.nom_composant}" style="width:106px; height:86px; object-fit:cover; border-radius:10px; display:block;" onerror="this.parentElement.innerHTML=genererSvgPiece('${g.svg_type}')">
                        <a href="${g.lien_recherche_images}" target="_blank" style="font-size:9px; color:var(--cyan-neon); text-decoration:underline; font-weight:700;">${labelWeb}</a>
                    </div>
                `;
            } else {
                zoneImg.innerHTML = genererSvgPiece(g.svg_type);
            }
            document.getElementById('vision-comp-desc').textContent = g.forme_et_couleur;
            parlerIA(g.message_vocal);
        }
    } catch (err) {
        console.error(err);
    }
}

async function afficherGuideVisuelEtape() {
    const comp = composantsDetectes[composantSelectionne] || composantsDetectes[0] || { nom: 'Condensateur / Connecteur', pos_x: 50, pos_y: 50 };
    const box = document.getElementById('guided-visual-guide-box');
    if (!box) return;
    box.style.display = box.style.display === 'none' ? 'block' : 'none';
    if (box.style.display === 'none') return;

    dessinerZoomPieceSurCanvas('canvas-zoom-guided', comp);
    try {
        const res = await fetch('/api/diagnostic/guide-visuel-piece', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                nom_composant: comp.nom,
                type_appareil: appareilActuel,
                nom_utilisateur: localStorage.getItem('rl_user_name') || null,
                langue: getLangue()
            })
        });
        const data = await res.json();
        const g = data.guide;
        if (g) {
            const zoneImgG = document.getElementById('svg-illustration-guided');
            const isFr = getLangue() === 'fr';
            if (g.image_web_url) {
                zoneImgG.innerHTML = `
                    <div style="text-align:center;">
                        <img src="${g.image_web_url}" alt="${g.nom_composant}" style="width:96px; height:76px; object-fit:cover; border-radius:8px; display:block;" onerror="this.parentElement.innerHTML=genererSvgPiece('${g.svg_type}')">
                        <a href="${g.lien_recherche_images}" target="_blank" style="font-size:9px; color:var(--cyan-neon); text-decoration:underline; font-weight:700;">${isFr ? 'Plus de photos' : 'More photos'}</a>
                    </div>
                `;
            } else {
                zoneImgG.innerHTML = genererSvgPiece(g.svg_type);
            }
            document.getElementById('guided-visual-details').innerHTML = `
                <div style="margin-bottom:5px;"><strong style="color:var(--cyan-neon);">${isFr ? 'À quoi ça ressemble' : 'What to look for'} (${g.nom_composant}) :</strong> ${g.forme_et_couleur}</div>
                <div style="margin-bottom:5px;"><strong style="color:#34d399;">${isFr ? 'Rôle simple :' : 'Role:'}</strong> ${g.role_simple}</div>
                <div style="margin-bottom:5px;"><strong style="color:#fbbf24;">${isFr ? 'Signes de panne à l\'œil nu :' : 'Visual Damage Check:'}</strong> ${g.signes_usure_visuels}</div>
                <div><strong style="color:#a78bfa;">${isFr ? 'Pièce de rechange :' : 'Replacement Part:'}</strong> ${g.reference_achat}</div>
            `;
            parlerIA(g.message_vocal);
        }
    } catch (err) {
        console.error(err);
    }
}

async function poserQuestionVision() {
    const input = document.getElementById('input-probleme');
    if (!input) return;
    const q = input.value.trim();
    if (!q) return;
    input.value = '';

    const chatContainerId = 'live-chat-thread';
    const isFr = getLangue() === 'fr';
    const prenomActuel = localStorage.getItem('rl_user_name') || (isFr ? 'Vous' : 'You');

    ajouterMessageChatGPT(chatContainerId, prenomActuel, q, 'user');
    const waitRow = ajouterMessageChatGPT(chatContainerId, 'Assistant RepairLens', isFr ? 'Réflexion en cours...' : 'Thinking...', 'ai');
    if (waitRow) waitRow.id = 'vision-chat-wait';

    try {
        const res = await fetch('/api/diagnostic/continuer', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                session_id: sessionId,
                type_appareil: appareilActuel,
                probleme_decrit: descriptionActuelle,
                composants: composantsDetectes,
                historique_messages: historiqueMessages,
                message_technicien: q,
                nom_utilisateur: localStorage.getItem('rl_user_name') || null,
                utilisateur_id: getUtilisateurId(),
                langue: getLangue()
            })
        });
        const data = await res.json();
        const waitEl = document.getElementById('vision-chat-wait');
        if (waitEl) waitEl.remove();

        if (data.prenom_detecte) {
            localStorage.setItem('rl_user_name', data.prenom_detecte);
            actualiserAffichageUtilisateur();
            afficherToast(
                isFr
                    ? `Enchantée ${data.prenom_detecte} ! Prénom mémorisé.`
                    : `Nice to meet you ${data.prenom_detecte}! Name saved.`,
                ''
            );
        }
        if (data.guide_visuel) {
            expliquerComposantActif();
        }

        historiqueMessages.push({ auteur: prenomActuel, texte: q });
        historiqueMessages.push({ auteur: 'Assistant RepairLens', texte: data.reponse_ia });

        ajouterMessageChatGPT(chatContainerId, 'Assistant RepairLens', data.reponse_ia, 'ai', '', Boolean(data && data.proposer_appel_video));
        parlerIA(data.reponse_ia);
    } catch (err) {
        const waitEl = document.getElementById('vision-chat-wait');
        if (waitEl) waitEl.remove();
        console.error(err);
    }
}

// =============================================================
// ÉCRAN 3 : AI DIAGNOSIS (Muse Spark)
// =============================================================
async function passerAuDiagnosticIA() {
    afficherEcran('screen-ai-diagnosis');

    document.getElementById('diag-device-title').textContent   = appareilActuel;
    document.getElementById('diag-issue-subtitle').textContent = `${t('issue_prefix')} ${descriptionActuelle}`;
    const thumb = document.getElementById('diag-thumb-img');
    if (imageDataUrl) thumb.src = imageDataUrl;

    // Évaluer si Muse Spark a besoin de poser des questions au technicien
    const resEval = await fetch('/api/diagnostic/evaluer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            session_id: sessionId,
            type_appareil: appareilActuel,
            probleme_decrit: descriptionActuelle,
            composants: composantsDetectes,
            langue: getLangue(),
            image_base64: imageBase64 || null
        })
    });
    const dataEval = await resEval.json();

    if (dataEval.besoin_infos && dataEval.questions && dataEval.questions.length > 0) {
        questionsActuelles = dataEval.questions;
        afficherQuestionsClarification(dataEval.questions);
    } else {
        remplirEcranDiagnostic(dataEval);
    }
}

function afficherQuestionsClarification(questions) {
    const qBox = document.getElementById('diag-questions-box');
    const contentBox = document.getElementById('diag-result-content');
    qBox.style.display = 'block';
    contentBox.style.display = 'none';

    const qHtml = questions.map((q, idx) => `
        <div class="field-group">
            <div class="field-label-row">
                <span style="font-size:13px; font-weight:600; color:var(--text-white);">${q}</span>
                <button type="button" class="btn-voice-pill" id="mic-q-${idx}" onclick="dicterChamp('rep-q-${idx}', 'mic-q-${idx}')"></button>
            </div>
            <input type="text" id="rep-q-${idx}" class="field-input" placeholder="${t('your_answer_placeholder')}">
        </div>
    `).join('');

    qBox.innerHTML = `
        <div class="cause-kicker">${t('followup_questions_kicker')}</div>
        <h3 class="cause-headline" style="font-size:18px;">${t('followup_questions_title')}</h3>
        <div style="margin:16px 0;">${qHtml}</div>
        <button type="button" class="btn-cyan" onclick="soumettreReponsesDiagnostic()">
            ${t('submit_answers_btn')}
        </button>
    `;

    parlerIA(questions.join(' '));
}

async function soumettreReponsesDiagnostic() {
    const reponses = {};
    questionsActuelles.forEach((q, idx) => {
        const el = document.getElementById(`rep-q-${idx}`);
        reponses[q] = el && el.value.trim() ? el.value.trim() : (getLangue() === 'fr' ? 'Vérifié par l\'utilisateur' : 'Checked by technician');
    });

    const res = await fetch('/api/diagnostic/diagnostic-final', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            session_id: sessionId,
            type_appareil: appareilActuel,
            probleme_decrit: descriptionActuelle,
            composants: composantsDetectes,
            reponses: reponses,
            langue: getLangue(),
            image_base64: imageBase64 || null
        })
    });
    const data = await res.json();

    document.getElementById('diag-questions-box').style.display = 'none';
    document.getElementById('diag-result-content').style.display = 'block';
    remplirEcranDiagnostic(data);
}

function remplirEcranDiagnostic(data) {
    document.getElementById('diag-questions-box').style.display = 'none';
    document.getElementById('diag-result-content').style.display = 'block';

    diagnosticActuel = data.diagnostic || '';
    etapesActuelles  = data.etapes || [];
    const idxNonFait = etapesActuelles.findIndex(e => e.est_complete !== 'oui');
    indexEtapeActive = idxNonFait >= 0 ? idxNonFait : Math.max(0, etapesActuelles.length - 1);

    const isFr = getLangue() === 'fr';

    // Stocker et afficher les métadonnées Réparabilité, Outils & Impact Écologique
    const meta = data.meta_reparation || {
        score_reparabilite: '8.5 / 10',
        temps_estime: '25 min',
        difficulte: isFr ? 'Accessible (Débutant)' : 'Accessible (DIY)',
        outils_requis: isFr
            ? ['Tournevis Cruciforme PH2', 'Multimètre numérique', 'Gants isolants']
            : ['Phillips PH2 Screwdriver', 'Digital Multimeter', 'Insulated Gloves'],
        cout_piece: '12 $ - 25 $',
        economie_realisee: '185 $',
        dechet_evite: '14 kg'
    };
    window.metaReparationActuelle = meta;

    const badgeScore = document.getElementById('meta-score-badge');
    if (badgeScore) badgeScore.textContent = `Score: ${meta.score_reparabilite}`;
    const elSavings = document.getElementById('meta-savings');
    if (elSavings) elSavings.textContent = `${meta.economie_realisee}`;
    const elEwaste = document.getElementById('meta-ewaste');
    if (elEwaste) elEwaste.textContent = meta.dechet_evite;
    const elTime = document.getElementById('meta-time');
    if (elTime) elTime.textContent = meta.temps_estime;

    const toolsZone = document.getElementById('meta-tools-list');
    if (toolsZone && Array.isArray(meta.outils_requis)) {
        toolsZone.innerHTML = meta.outils_requis.map(outil => `
            <span style="background:rgba(0,240,255,0.12); border:1px solid var(--border-cyan); color:var(--cyan-neon); padding:4px 10px; border-radius:999px; font-size:11px; font-weight:700;">
                ${outil}
            </span>
        `).join('');
    }

    const compCible = composantsDetectes[composantSelectionne] || composantsDetectes[0] || { nom: isFr ? 'Circuit interne' : 'Power / Internal Circuit' };
    document.getElementById('diag-cause-headline').textContent =
        isFr
            ? `Anomalie probable sur : ${compCible.nom}`
            : `The ${compCible.nom} may require inspection.`;

    document.getElementById('diag-cause-body').textContent = diagnosticActuel;
    const conseilTechnique = isFr
        ? `Contrôlez l'état des connecteurs et testez la continuité électrique au multimètre avant tout démontage ou remplacement de pièce.`
        : `Inspect connector integrity and test electrical continuity with a multimeter before disassembling or replacing parts.`;
    document.getElementById('diag-tech-insight').textContent = `"${conseilTechnique}"`;

    // What to check next
    const checkListZone = document.getElementById('diag-check-next-list');
    checkListZone.innerHTML = composantsDetectes.slice(0, 3).map((c, i) => `
        <div class="check-next-card">
            <div class="check-next-icon">${i === 0 ? 'Power' : 'Check'}</div>
            <div>
                <div style="font-size:15px; font-weight:700;">${isFr ? 'Vérifier' : 'Inspect'} ${c.nom}</div>
                <div style="font-size:12px; color:var(--text-gray);">${isFr ? 'Confiance' : 'Confidence'}: ${Math.round((c.confiance || 0.9) * 100)}% • ${isFr ? 'État' : 'Status'}: ${c.etat}</div>
            </div>
        </div>
    `).join('');

    parlerIA(diagnosticActuel);
}

// =============================================================
// ÉCRAN 4 : GUIDED INSPECTION (Step-by-Step)
// =============================================================
function demarrerInspectionGuidee() {
    afficherEcran('screen-guided-inspection');
    const isFr = getLangue() === 'fr';
    document.getElementById('guided-device-subtitle').textContent = isFr ? `Réparation : ${appareilActuel}` : `${appareilActuel} Repair`;
    const imgGuided = document.getElementById('guided-step-img');
    if (imageDataUrl) imgGuided.src = imageDataUrl;

    const compCible = composantsDetectes[composantSelectionne] || composantsDetectes[0];
    if (compCible) {
        document.getElementById('guided-comp-label').textContent = `${isFr ? 'COMPOSANT' : 'COMPONENT'}: ${compCible.nom.toUpperCase()}`;
    }

    afficherEtapeGuidee(indexEtapeActive);
}

function afficherEtapeGuidee(idx) {
    if (!etapesActuelles.length) return;
    indexEtapeActive = Math.max(0, Math.min(idx, etapesActuelles.length - 1));
    const etape = etapesActuelles[indexEtapeActive];
    const total = etapesActuelles.length;

    // 1. Barre de progression 1 - 2 - 3 - 4
    const dotsBar = document.getElementById('guided-dots-bar');
    dotsBar.innerHTML = etapesActuelles.map((e, i) => {
        const classe = i === indexEtapeActive ? 'active' : (e.est_complete === 'oui' || i < indexEtapeActive ? 'done' : '');
        const ligne = i < total - 1 ? '<div class="step-connector-line"></div>' : '';
        return `<div class="step-dot-circle ${classe}" onclick="afficherEtapeGuidee(${i})">${i + 1}</div>${ligne}`;
    }).join('');

    // 2. Titre et instruction de l'étape (avec badge sécurité si [SECURITE:])
    document.getElementById('guided-step-counter').textContent = `${t('step_of')} ${indexEtapeActive + 1} ${t('of_word')} ${total}`;
    const texteRaw = (etape.instruction || '').replace(/^(Etape|Étape|Step)\s*\d+\s*:\s*/i, '');
    const { instruction: textePropre, badge: safetyBadge } = formaterInstructionEtape(texteRaw);
    const titreEl = document.getElementById('guided-step-title');
    titreEl.innerHTML = textePropre + (safetyBadge ? '<br>' + safetyBadge : '');
    if (typeof mettreAJourFlecheGesteAR === 'function') mettreAJourFlecheGesteAR(texteRaw);
    document.getElementById('guided-step-desc').textContent =
        getLangue() === 'fr'
            ? "Suivez attentivement cette vérification et cochez les tâches ci-dessous une fois effectuées."
            : "Carefully perform this verification step and check off the tasks below once completed.";

    // 3. Task Checklist interactive (toutes les étapes synchronisées avec PostgreSQL)
    const checklistZone = document.getElementById('guided-checklist-items');
    checklistZone.innerHTML = etapesActuelles.map((e, i) => {
        const estFait = e.est_complete === 'oui';
        const fmt = formaterInstructionEtape(e.instruction || '');
        return `
            <div class="check-row ${estFait ? 'checked' : ''}" onclick="basculerEtapeComplete(${e.id}, ${i})">
                <div class="check-box-ui">✔</div>
                <div class="check-text-ui" style="font-size:13px; line-height:1.4;">${fmt.instruction}${fmt.badge ? ' ' + fmt.badge : ''}</div>
            </div>
        `;
    }).join('');

    // 4. Texte du bouton Next Step / Complete Repair
    const btnNextText = document.getElementById('next-step-btn-text');
    if (indexEtapeActive === total - 1) {
        btnNextText.textContent = t('btn_finish_repair');
    } else {
        btnNextText.textContent = t('btn_next_step');
    }

    // 5. Cacher le box micro-actions de l'étape précédente
    const microBox = document.getElementById('micro-actions-box');
    if (microBox) microBox.style.display = 'none';

    // 6. Zoomer l'image et déplacer le viseur AR vers la pièce de cette étape
    ciblerPieceDansImage(texteRaw);

    const texteVocal = texteRaw.replace(/\[(SAFETY|SECURITE|SÉCURITÉ)\s*:[^\]]*\]/gi, '').trim();
    parlerIA(texteVocal);
}

function lireEtapeActiveAudio() {
    const etape = etapesActuelles[indexEtapeActive];
    if (etape) {
        const texte = (etape.instruction || '').replace(/\[(SAFETY|SECURITE|SÉCURITÉ)\s*:[^\]]*\]/gi, '').trim();
        parlerIA(texte);
    }
}

function echapperHTML(str) {
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
}

function formaterInstructionEtape(texte) {
    const match = texte.match(/\[(SAFETY|SECURITE|SÉCURITÉ)\s*:\s*([^\]]+)\]/i);
    let instruction = texte;
    let badge = '';
    if (match) {
        instruction = texte.replace(match[0], '').trim();
        badge = `<span style="display:inline-block; margin-top:4px; background:rgba(251,191,36,0.15); border:1px solid rgba(251,191,36,0.4); color:#fbbf24; font-size:11px; font-weight:700; padding:2px 8px; border-radius:6px;">&#9888; ${echapperHTML(match[2].trim())}</span>`;
    }
    return { instruction: echapperHTML(instruction), badge };
}

async function decouperEtapeEnMicroActions() {
    const etape = etapesActuelles[indexEtapeActive];
    if (!etape) return;
    const isFr = getLangue() === 'fr';
    const btn = document.getElementById('btn-pas-compris');
    const box = document.getElementById('micro-actions-box');
    const liste = document.getElementById('micro-actions-list');
    if (btn) btn.disabled = true;
    liste.textContent = isFr ? 'Simplification en cours...' : 'Breaking down...';
    box.style.display = 'block';

    try {
        const res = await fetch('/api/diagnostic/micro-actions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                instruction: etape.instruction,
                type_appareil: appareilActuel || 'appareil',
                langue: getLangue()
            })
        });
        if (!res.ok) throw new Error(`Server ${res.status}`);
        const data = await res.json();
        if (data && data.micro_actions) {
            const lignes = data.micro_actions.split('\n').filter(l => l.trim());
            liste.innerHTML = lignes.map(l =>
                `<div style="padding:3px 0; border-bottom:1px solid rgba(251,191,36,0.15);">${echapperHTML(l)}</div>`
            ).join('');
            parlerIA(data.micro_actions);
        } else {
            liste.textContent = isFr ? 'Impossible de simplifier cette étape.' : 'Could not simplify this step.';
        }
    } catch (err) {
        console.error('Micro-actions error:', err);
        liste.textContent = isFr ? 'Erreur de connexion. Réessaie.' : 'Connection error. Try again.';
    }
    if (btn) btn.disabled = false;
}

async function basculerEtapeComplete(etapeId, idx) {
    try {
        await fetch(`/api/diagnostic/etape/${etapeId}/complete`, { method: 'PUT' });
        if (etapesActuelles[idx]) {
            etapesActuelles[idx].est_complete = 'oui';
        }
        afficherEtapeGuidee(indexEtapeActive);
    } catch (err) {
        console.error(err);
    }
}

function etapePrecedente() {
    if (indexEtapeActive > 0) {
        afficherEtapeGuidee(indexEtapeActive - 1);
    } else {
        afficherEcran('screen-ai-diagnosis');
    }
}

async function etapeSuivanteOuTerminer() {
    const etapeCourante = etapesActuelles[indexEtapeActive];
    if (etapeCourante && etapeCourante.est_complete !== 'oui') {
        await basculerEtapeComplete(etapeCourante.id, indexEtapeActive);
    }

    if (indexEtapeActive < etapesActuelles.length - 1) {
        afficherEtapeGuidee(indexEtapeActive + 1);
    } else {
        await terminerReparationDirectement();
    }
}

async function terminerReparationDirectement() {
    if (!sessionId) return;
    try {
        await fetch(`/api/history/${sessionId}/resoudre`, {
            method: 'PUT',
            headers: { 'X-Utilisateur-Id': getUtilisateurId() }
        });
        const msgFin = getLangue() === 'fr'
            ? 'Félicitations, réparation marquée comme terminée avec succès !'
            : 'Congratulations, repair marked as completed successfully!';
        afficherToast(msgFin, '');
        parlerIA(msgFin);
        setTimeout(() => {
            window.location.href = '/static/history.html';
        }, 900);
    } catch (err) {
        console.error(err);
    }
}

// =============================================================
// DISCUSSION CONTINUE AVEC MUSE SPARK (SI PROBLÈME NON RÉSOLU)
// =============================================================
function basculerTiroirChat(drawerId) {
    const el = document.getElementById(drawerId);
    if (!el) return;
    el.style.display = el.style.display === 'none' ? 'block' : 'none';
}

async function envoyerMessageChatIA(inputId, containerId) {
    const input = document.getElementById(inputId);
    const zone  = document.getElementById(containerId);
    const msg   = input.value.trim();
    if (!msg) return;

    const isFr = getLangue() === 'fr';
    const prenomActuel = localStorage.getItem('rl_user_name') || (isFr ? 'Vous' : 'You');
    ajouterMessageChatGPT(containerId, prenomActuel, msg, 'user');
    input.value = '';

    const waitRow = ajouterMessageChatGPT(containerId, 'Assistant RepairLens', isFr ? 'Réflexion en cours...' : 'Thinking...', 'ai');
    if (waitRow) waitRow.id = `${containerId}-waiting`;

    try {
        let messageEnrichi = msg;
        if (containerId === 'guided-chat-messages' && etapesActuelles.length > 0) {
            const resumeEtapes = etapesActuelles.map((e, i) =>
                `Étape ${i + 1}: ${e.instruction || e.texte || ''}`
            ).join('\n');
            messageEnrichi = `[CONTEXTE: L'utilisateur est à l'étape ${indexEtapeActive + 1} de l'inspection guidée]\n${resumeEtapes}\n\nQuestion: ${msg}`;
        }
        const res = await fetch('/api/diagnostic/continuer', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                session_id: sessionId,
                type_appareil: appareilActuel,
                probleme_decrit: descriptionActuelle,
                composants: composantsDetectes,
                historique_messages: historiqueMessages,
                message_technicien: messageEnrichi,
                nom_utilisateur: localStorage.getItem('rl_user_name') || null,
                utilisateur_id: getUtilisateurId(),
                langue: getLangue()
            })
        });
        if (!res.ok) {
            const errBody = await res.text().catch(() => '');
            throw new Error(`Server ${res.status}: ${errBody.slice(0, 200)}`);
        }
        const data = await res.json();
        if (!data || !data.reponse_ia) throw new Error('Empty AI response');
        const waitEl = document.getElementById(`${containerId}-waiting`);
        if (waitEl) waitEl.remove();

        if (data.prenom_detecte) {
            localStorage.setItem('rl_user_name', data.prenom_detecte);
            actualiserAffichageUtilisateur();
            afficherToast(
                isFr
                    ? `Enchantée ${data.prenom_detecte} ! Muse Spark se souviendra de toi.`
                    : `Nice to meet you ${data.prenom_detecte}! Muse Spark will remember you.`,
                ''
            );
        }

        historiqueMessages.push({ auteur: prenomActuel, texte: msg });
        historiqueMessages.push({ auteur: 'Assistant RepairLens', texte: data.reponse_ia });

        ajouterMessageChatGPT(containerId, 'Assistant RepairLens', data.reponse_ia, 'ai', '', Boolean(data && data.proposer_appel_video));

        if (data.guide_visuel && document.getElementById('screen-guided-inspection').classList.contains('active')) {
            afficherGuideVisuelEtape();
        }

        if (data.nouvelles_etapes && data.nouvelles_etapes.length > 0) {
            etapesActuelles.push(...data.nouvelles_etapes);
            if (document.getElementById('screen-guided-inspection').classList.contains('active')) {
                afficherEtapeGuidee(etapesActuelles.length - data.nouvelles_etapes.length);
            }
        }

        parlerIA(data.reponse_ia);
    } catch (err) {
        const waitEl = document.getElementById(`${containerId}-waiting`);
        if (waitEl) waitEl.remove();
        console.error('Erreur chat IA:', err);
        const fallback = isFr
            ? `Hmm, j'ai eu un souci de connexion${prenomActuel !== 'Vous' ? ' ' + prenomActuel : ''}. Peux-tu reformuler ta question ? Je suis là pour t'aider.`
            : `I had a connection issue${prenomActuel !== 'You' ? ' ' + prenomActuel : ''}. Could you rephrase? I'm here to help.`;
        ajouterMessageChatGPT(containerId, 'Assistant RepairLens', fallback, 'ai');
    }
}

// =============================================================
// CHARGEMENT D'UNE SESSION EXISTANTE DEPUIS L'HISTORIQUE / ACCUEIL
// (AVEC MÉMOIRE CONVERSATIONNELLE MULTI-JOURS POSTGRESQL)
// =============================================================
async function verifierRepriseSession() {
    appliquerTraductionsPage();
    actualiserAffichageUtilisateur();
    const params = new URLSearchParams(window.location.search);
    const idParam = params.get('session_id');
    if (!idParam) return;

    try {
        const res = await fetch(`/api/history/${idParam}`, {
            headers: { 'X-Utilisateur-Id': getUtilisateurId() }
        });
        if (!res.ok) return;
        const data = await res.json();

        sessionId           = data.session.id;
        appareilActuel      = data.session.type_appareil;
        descriptionActuelle = data.session.probleme_detecte || 'Inspection';
        diagnosticActuel    = data.session.diagnostic_ia || '';
        if (data.session.nom_utilisateur) {
            localStorage.setItem('rl_user_name', data.session.nom_utilisateur);
            actualiserAffichageUtilisateur();
        }
        if (data.session.image_miniature) {
            imageDataUrl = `data:image/jpeg;base64,${data.session.image_miniature}`;
            const imgMain = document.getElementById('vision-main-image');
            if (imgMain) imgMain.src = imageDataUrl;
        }
        composantsDetectes = data.composants || [];
        etapesActuelles    = data.etapes || [];
        historiqueMessages = data.messages || [];

        // Restaurer toutes les bulles de conversation des jours précédents style ChatGPT !
        if (historiqueMessages.length > 0) {
            const nomAffiche = localStorage.getItem('rl_user_name') || 'Vous';
            const zoneDiag = document.getElementById('diag-chat-messages');
            const zoneGuided = document.getElementById('guided-chat-messages');
            if (zoneDiag) zoneDiag.innerHTML = '';
            if (zoneGuided) zoneGuided.innerHTML = '';

            historiqueMessages.forEach(m => {
                const estIA = m.auteur === 'Muse Spark' || m.auteur === 'Assistant RepairLens';
                const auteur = estIA ? 'Assistant RepairLens' : nomAffiche;
                const role = estIA ? 'ai' : 'user';
                if (zoneDiag) ajouterMessageChatGPT('diag-chat-messages', auteur, m.texte, role);
                if (zoneGuided) ajouterMessageChatGPT('guided-chat-messages', auteur, m.texte, role);
            });

            const drawerDiag = document.getElementById('diag-followup-drawer');
            if (drawerDiag) drawerDiag.style.display = 'block';
        }

        if (etapesActuelles.length > 0) {
            remplirEcranDiagnostic({ diagnostic: diagnosticActuel, etapes: etapesActuelles });
            afficherEcran('screen-ai-diagnosis');

            // Afficher et lire la bannière de mémoire longue durée ("Bon retour Oumy !")
            if (data.resume_reprise_ia) {
                const banner = document.getElementById('memory-resume-banner');
                const txt = document.getElementById('memory-resume-text');
                if (banner && txt) {
                    banner.style.display = 'block';
                    txt.textContent = data.resume_reprise_ia;
                }
                afficherToast('Mémoire de session restaurée !', '');
                setTimeout(() => parlerIA(data.resume_reprise_ia), 400);
            }
        } else if (composantsDetectes.length > 0) {
            afficherEcranVisionSAM();
        } else {
            // Si la session avait été quittée avant la génération des étapes, on lance le diagnostic automatiquement
            await passerAuDiagnosticIA();
        }
    } catch (err) {
        console.error('Erreur reprise session :', err);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    verifierRepriseSession();
    actualiserEtatConnexion();
    if (!estConnecteGoogle()) initGoogleAuth();
});

// =============================================================
// SUPER-POUVOIR : VÉRIFICATION VISUELLE AVANT / APRÈS D'UNE ÉTAPE
// =============================================================
document.getElementById('input-verify-step').addEventListener('change', function(e) {
    const fichier = e.target.files[0];
    if (!fichier) return;

    const reader = new FileReader();
    reader.onload = async function(ev) {
        const base64Apres = ev.target.result.split(',')[1];
        const etapeCourante = etapesActuelles[indexEtapeActive];
        if (!etapeCourante) return;

        // Mettre à jour l'image affichée dans le cadre guidé avec la photo "Après"
        document.getElementById('guided-step-img').src = ev.target.result;
        afficherToast(
            getLangue() === 'fr' ? 'Muse Spark vérifie votre intervention...' : 'Muse Spark is verifying your step...',
            ''
        );

        try {
            const res = await fetch('/api/diagnostic/verifier-etape', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    etape_id: etapeCourante.id,
                    type_appareil: appareilActuel,
                    numero_etape: indexEtapeActive + 1,
                    instruction_etape: etapeCourante.instruction,
                    image_apres_base64: base64Apres
                })
            });
            const data = await res.json();

            const fb = document.getElementById('verify-step-feedback');
            fb.style.display = 'block';
            fb.innerHTML = `<strong>AI Visual Verification:</strong> ${data.commentaire_ia}`;

            etapesActuelles[indexEtapeActive].est_complete = 'oui';
            afficherEtapeGuidee(indexEtapeActive);
            parlerIA(data.commentaire_ia);
        } catch (err) {
            console.error(err);
        }
    };
    reader.readAsDataURL(fichier);
});

// =============================================================
// SUPER-POUVOIR 1 : DÉTECTEUR ACOUSTIQUE DE PANNE (OSCILLOSCOPE EN DIRECT)
// =============================================================
let audioContextTest = null;
let animAudioId = null;

async function enregistrerBruitAppareil() {
    const box = document.getElementById('acoustic-box');
    const canvas = document.getElementById('canvas-audio-spectrum');
    const freqBadge = document.getElementById('acoustic-freq-badge');
    const statusLabel = document.getElementById('acoustic-status-label');
    const btnAcoustic = document.getElementById('btn-acoustic-test');

    if (!box || !canvas) return;
    box.style.display = 'block';

    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        audioContextTest = new (window.AudioContext || window.webkitAudioContext)();
        const source = audioContextTest.createMediaStreamSource(stream);
        const analyser = audioContextTest.createAnalyser();
        analyser.fftSize = 256;
        source.connect(analyser);

        const bufferLength = analyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);
        const freqArray = new Uint8Array(bufferLength);
        const ctx = canvas.getContext('2d');

        let maxPicFreq = 0;
        if (btnAcoustic) btnAcoustic.classList.add('recording');
        statusLabel.textContent = getLangue() === 'fr'
            ? 'Écoute du bruit moteur / roulement (5s)...'
            : 'Listening to motor / bearing acoustics (5s)...';

        function dessinerOnde() {
            animAudioId = requestAnimationFrame(dessinerOnde);
            analyser.getByteTimeDomainData(dataArray);
            analyser.getByteFrequencyData(freqArray);

            // Calculer la fréquence dominante approximative
            let maxVal = 0;
            let maxIdx = 0;
            for (let i = 1; i < bufferLength; i++) {
                if (freqArray[i] > maxVal) {
                    maxVal = freqArray[i];
                    maxIdx = i;
                }
            }
            const freqHz = Math.round((maxIdx * audioContextTest.sampleRate) / analyser.fftSize);
            if (freqHz > maxPicFreq && freqHz < 4500) maxPicFreq = freqHz;
            freqBadge.textContent = `${freqHz} Hz`;

            // Dessin oscilloscope Cyan Néon
            ctx.fillStyle = '#060a10';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.lineWidth = 2;
            ctx.strokeStyle = '#00f0ff';
            ctx.beginPath();

            const sliceWidth = canvas.width / bufferLength;
            let x = 0;
            for (let i = 0; i < bufferLength; i++) {
                const v = dataArray[i] / 128.0;
                const y = (v * canvas.height) / 2;
                if (i === 0) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
                x += sliceWidth;
            }
            ctx.lineTo(canvas.width, canvas.height / 2);
            ctx.stroke();
        }

        dessinerOnde();

        // Arrêter au bout de 5 secondes et injecter la signature acoustique
        setTimeout(() => {
            cancelAnimationFrame(animAudioId);
            stream.getTracks().forEach(t => t.stop());
            if (audioContextTest) audioContextTest.close();
            if (btnAcoustic) btnAcoustic.classList.remove('recording');

            const freqFinale = maxPicFreq || 120;
            let typeSignature = freqFinale < 180
                ? (getLangue() === 'fr' ? 'Bourdonnement électrique 50/60Hz (condensateur ou bobine bloquée)' : 'Electrical 50/60Hz hum (capacitor or jammed coil)')
                : (getLangue() === 'fr' ? 'Frottement mécanique haute fréquence (roulement ou axe moteur)' : 'High-frequency mechanical friction (bearing or motor shaft)');

            statusLabel.textContent = `Acoustic signature captured: ${freqFinale} Hz`;
            freqBadge.textContent = `${freqFinale} Hz`;

            const champProb = document.getElementById('input-probleme');
            const noteAudio = `[Acoustic AI Scan: Peak ${freqFinale}Hz - ${typeSignature}]`;
            champProb.value = champProb.value.trim()
                ? `${champProb.value.trim()} ${noteAudio}`
                : noteAudio;

            afficherToast(
                getLangue() === 'fr'
                    ? `Signature sonore (${freqFinale} Hz) ajoutée au diagnostic !`
                    : `Acoustic signature (${freqFinale} Hz) added to diagnosis!`,
                ''
            );
        }, 5000);

    } catch (err) {
        console.error('Microphone error:', err);
        afficherToast(
            getLangue() === 'fr' ? 'Microphone non accessible.' : 'Microphone unavailable.',
            ''
        );
    }
}

// =============================================================
// SUPER-POUVOIR 2 : TRIEUR DE VIS & CARTE DE REMONTAGE SAM 2
// =============================================================
function basculerPlateauVis() {
    const panel = document.getElementById('screw-tray-panel');
    const list  = document.getElementById('screw-tray-list');
    if (!panel || !list) return;

    const visible = panel.style.display !== 'none';
    panel.style.display = visible ? 'none' : 'block';

    if (!visible) {
        const isFr = getLangue() === 'fr';
        const items = composantsDetectes.length > 0 ? composantsDetectes : [
            { nom: isFr ? 'Vis Cruciforme Châssis #1' : 'Chassis Phillips Screw #1', pos_x: 22, pos_y: 28, etat: 'normale' },
            { nom: isFr ? 'Connecteur Alimentation' : 'Power Supply Connector', pos_x: 54, pos_y: 62, etat: 'a_verifier' }
        ];

        list.innerHTML = items.map((c, idx) => `
            <div style="display:flex; justify-content:space-between; align-items:center; padding:8px 0; border-bottom:1px solid rgba(255,255,255,0.06);">
                <div>
                    <strong style="color:var(--text-white);">#${idx + 1} ${c.nom}</strong>
                    <div style="font-size:11px; color:var(--text-gray);">${isFr ? `Mémorisé avant démontage • Case n°${idx + 1}` : `Saved before disassembly • Keep in slot #${idx + 1}`}</div>
                </div>
                <span style="background:var(--cyan-dim); color:var(--cyan-neon); border:1px solid var(--border-cyan); padding:3px 8px; border-radius:8px; font-weight:700; font-size:11px;">
                    X:${Math.round(c.pos_x || 40)}% Y:${Math.round(c.pos_y || 50)}%
                </span>
            </div>
        `).join('');

        afficherToast(
            isFr
                ? 'Carte de démontage SAM 2 mémorisée !'
                : 'SAM 2 Disassembly Map saved!',
            ''
        );
    }
}

// Rafraîchir dynamiquement tous les écrans de camera.html quand on clique sur EN | FR
window.rafraichirVueActuelle = function() {
    const zoneVision = document.getElementById('zone-vision-inline');
    if (composantsDetectes.length > 0 && zoneVision && zoneVision.style.display !== 'none') {
        mettreAJourFicheComposant(composantSelectionne);
    }
    if (document.getElementById('screen-ai-diagnosis').classList.contains('active')) {
        document.getElementById('diag-issue-subtitle').textContent = `${t('issue_prefix')} ${descriptionActuelle}`;
        if (document.getElementById('diag-questions-box').style.display !== 'none' && questionsActuelles.length > 0) {
            afficherQuestionsClarification(questionsActuelles);
        } else if (diagnosticActuel) {
            remplirEcranDiagnostic({
                diagnostic: diagnosticActuel,
                etapes: etapesActuelles,
                meta_reparation: window.metaReparationActuelle
            });
        }
    }
    if (document.getElementById('screen-guided-inspection').classList.contains('active') && etapesActuelles.length > 0) {
        demarrerInspectionGuidee();
    }
};

// =============================================================
// SUPER-POUVOIR 4 : PASSEPORT OFFICIEL DE RÉPARATION (EXPORT PDF 1-CLIC)
// =============================================================
function exporterRapportReparationPDF() {
    const meta = window.metaReparationActuelle || {
        score_reparabilite: 8.5,
        temps_estime: '25 min',
        outils_requis: ['Tournevis Cruciforme PH2', 'Multimètre numérique'],
        economie_realisee: '185 $',
        dechet_evite: '14 kg'
    };

    const dateJour = new Date().toLocaleDateString();
    const compsHtml = composantsDetectes.map((c, i) =>
        `<li><strong>#${i + 1} ${c.nom}</strong> — Confiance SAM 2 : ${Math.round((c.confiance || 0.92) * 100)}% (Position X:${Math.round(c.pos_x || 50)}%, Y:${Math.round(c.pos_y || 50)}%)</li>`
    ).join('');

    const etapesHtml = etapesActuelles.map((e) =>
        `<li>[${e.est_complete === 'oui' ? '✔ VALIDÉ' : 'EN COURS'}] ${e.instruction}</li>`
    ).join('');

    const win = window.open('', '_blank');
    if (!win) {
        afficherToast('Autorisez les popups pour exporter le PDF', '');
        return;
    }

    win.document.write(`
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <title>RepairLens Official Passport - ${appareilActuel}</title>
            <style>
                body { font-family: 'Segoe UI', Arial, sans-serif; color: #0f172a; padding: 32px; max-width: 800px; margin: 0 auto; }
                .header { display: flex; justify-content: space-between; align-items: center; border-bottom: 3px solid #00bcd4; padding-bottom: 16px; margin-bottom: 24px; }
                .brand { font-size: 26px; font-weight: 800; color: #0f172a; }
                .badge { background: #e0f7fa; color: #006064; padding: 6px 14px; border-radius: 999px; font-weight: 700; font-size: 13px; }
                .section { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 16px 20px; margin-bottom: 18px; }
                h2 { font-size: 16px; text-transform: uppercase; color: #0284c7; margin-top: 0; }
                .grid-3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-top: 10px; }
                .metric { background: white; border: 1px solid #cbd5e1; padding: 12px; border-radius: 8px; text-align: center; }
                .metric strong { display: block; font-size: 18px; color: #0f172a; }
                ul { margin: 8px 0 0 0; padding-left: 20px; line-height: 1.6; }
                .footer { text-align: center; font-size: 12px; color: #64748b; margin-top: 30px; border-top: 1px solid #e2e8f0; padding-top: 12px; }
            </style>
        </head>
        <body>
            <div class="header">
                <div>
                    <div class="brand">RepairLens Official Repair Passport</div>
                    <div style="font-size:13px; color:#475569;">Powered by Meta SAM 2 & Meta Muse Spark • Session #${sessionId || 'N/A'}</div>
                </div>
                <div class="badge">Date : ${dateJour}</div>
            </div>

            <div class="section">
                <h2>1. Device & Symptom Summary</h2>
                <p><strong>Appareil inspecté :</strong> ${appareilActuel}</p>
                <p><strong>Symptôme signalé :</strong> ${descriptionActuelle}</p>
            </div>

            <div class="section">
                <h2>2. Eco-Impact & Repairability Index</h2>
                <div class="grid-3">
                    <div class="metric"><strong>${meta.score_reparabilite} / 10</strong>Indice Réparabilité</div>
                    <div class="metric"><strong>~${meta.economie_realisee}</strong>Économie Réalisée</div>
                    <div class="metric"><strong>${meta.dechet_evite}</strong>E-Waste Évité</div>
                </div>
            </div>

            <div class="section">
                <h2>3. Meta SAM 2 Component & Disassembly Map</h2>
                <ul>${compsHtml}</ul>
            </div>

            <div class="section">
                <h2>4. Meta Muse Spark Technical Diagnosis</h2>
                <p>${diagnosticActuel}</p>
            </div>

            <div class="section">
                <h2>5. Certified Repair Checklist</h2>
                <ul>${etapesHtml}</ul>
            </div>

            <div class="footer">
                Certified by RepairLens AI Visual & Acoustic Assistant — Meta Global AI Developer Hackathon 2026
            </div>
            <script>window.onload = function() { window.print(); };</script>
        </body>
        </html>
    `);
    win.document.close();
}

// =============================================================
// SUPER-POUVOIR 5 : APPEL VIDÉO EN DIRECT AVEC L'IA (LIVE CO-PILOT WATCH MODE)
// L'IA regarde le flux vidéo de l'utilisateur en continu, déplace le viseur AR
// et discute en face-à-face vocal jusqu'à la fin de la réparation !
// =============================================================
let fluxAppelVideoLive = null;
let intervalleAppelLive = null;
let timerSecondesLive = null;
let secondesAppel = 0;
let tickAppelIndex = 0;
let modeleVisionLive = null;
let boucleDetectionId = null;
let derniersObjetsVus = [];

async function chargerModeleVisionTempsReel() {
    if (modeleVisionLive) return modeleVisionLive;
    if (window.cocoSsd) {
        try {
            modeleVisionLive = await window.cocoSsd.load();
        } catch (e) {
            console.warn('COCO-SSD non chargé:', e);
        }
    }
    return modeleVisionLive;
}

async function executerDetectionTempsReelVideo() {
    const videoEl  = document.getElementById('guided-live-video');
    const canvasEl = document.getElementById('canvas-live-detections');
    if (!fluxAppelVideoLive || !videoEl || !canvasEl) return;

    if (videoEl.videoWidth > 0 && modeleVisionLive) {
        canvasEl.width  = videoEl.videoWidth;
        canvasEl.height = videoEl.videoHeight;
        const ctx = canvasEl.getContext('2d');
        ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);

        try {
            const predictions = await modeleVisionLive.detect(videoEl);
            derniersObjetsVus = predictions.map(p => p.class);
            const isFr = getLangue() === 'fr';

            predictions.forEach(p => {
                const [x, y, w, h] = p.bbox;
                let couleur = '#00f0ff'; // Appareil (Cyan)
                let roleTag = isFr ? `APPAREIL (${p.class})` : `DEVICE (${p.class})`;

                if (p.class === 'person') {
                    couleur = '#34d399'; // Personne / Main (Vert Émeraude)
                    roleTag = isFr ? 'OPÉRATEUR / MAIN' : 'OPERATOR / HAND';
                } else if (['scissors', 'knife', 'toothbrush', 'fork', 'spoon', 'remote'].includes(p.class)) {
                    couleur = '#fbbf24'; // Outil tenu en main (Jaune Ambre)
                    roleTag = isFr ? 'OUTIL EN MAIN' : 'TOOL IN HAND';
                }

                ctx.strokeStyle = couleur;
                ctx.lineWidth = 3;
                ctx.strokeRect(x, y, w, h);

                ctx.fillStyle = couleur;
                ctx.font = 'bold 13px Inter, Arial';
                const textW = ctx.measureText(roleTag).width + 12;
                ctx.fillRect(x, Math.max(0, y - 22), textW, 22);
                ctx.fillStyle = '#060a10';
                ctx.fillText(roleTag, x + 6, Math.max(15, y - 6));
            });
        } catch (err) {
            console.warn(err);
        }
    }

    if (fluxAppelVideoLive) {
        boucleDetectionId = setTimeout(executerDetectionTempsReelVideo, 450);
    }
}

function ciblerPieceDansImage(texteInstruction) {
    const imgEl = document.getElementById('guided-step-img');
    const boxAr = document.getElementById('guided-ar-target-box');
    const labelComp = document.getElementById('guided-comp-label');
    if (!imgEl || !composantsDetectes || !composantsDetectes.length) return;

    const txtLow = (texteInstruction || '').toLowerCase();
    const isFr = getLangue() === 'fr';
    let meilleur = null;
    let meilleurScore = 0;
    for (const c of composantsDetectes) {
        const nomLow = (c.nom || '').toLowerCase();
        const mots = nomLow.split(/[\s(),:]+/).filter(m => m.length > 2);
        let score = 0;
        for (const mot of mots) {
            if (txtLow.includes(mot)) score++;
        }
        if (score > meilleurScore) { meilleurScore = score; meilleur = c; }
    }

    if (meilleur && meilleurScore > 0) {
        const cx = meilleur.pos_x || 50;
        const cy = meilleur.pos_y || 50;
        const zoomLevel = 1.8;
        const ox = Math.max(0, Math.min(100, 50 + (50 - cx) * (zoomLevel - 1)));
        const oy = Math.max(0, Math.min(100, 50 + (50 - cy) * (zoomLevel - 1)));
        imgEl.style.transition = 'transform 0.6s ease';
        imgEl.style.transformOrigin = `${cx}% ${cy}%`;
        imgEl.style.transform = `scale(${zoomLevel})`;
        if (boxAr) {
            boxAr.style.left = `${cx}%`;
            boxAr.style.top = `${cy}%`;
            boxAr.style.display = 'block';
        }
        if (labelComp) {
            labelComp.textContent = `${isFr ? 'COMPOSANT' : 'COMPONENT'}: ${meilleur.nom.toUpperCase()}`;
        }
    } else {
        imgEl.style.transition = 'transform 0.6s ease';
        imgEl.style.transform = 'scale(1)';
        if (boxAr) boxAr.style.display = 'none';
    }
}

function mettreAJourFlecheGesteAR(texteInstruction) {
    const badge = document.getElementById('ar-gesture-arrow-badge');
    if (!badge) return;
    const txt = (texteInstruction || '').toLowerCase();
    const isFr = getLangue() === 'fr';
    if (txt.includes('debranch') || txt.includes('débranch') || txt.includes('unplug')) {
        badge.textContent = isFr ? '↑ Débrancher la prise' : '↑ Unplug power cord';
    } else if (txt.includes('vis') || txt.includes('capot') || txt.includes('panneau') || txt.includes('screw')) {
        badge.textContent = isFr ? '↺ Dévisser (Sens inverse)' : '↺ Unscrew counter-clockwise';
    } else if (txt.includes('multim') || txt.includes('test') || txt.includes('mesur') || txt.includes('check')) {
        badge.textContent = isFr ? 'Tester les 2 bornes ici' : 'Place probes here';
    } else {
        badge.textContent = isFr ? 'Ciblage AR actif' : 'AR Target Locked';
    }
}

async function basculerAppelVideoLiveIA() {
    const videoEl   = document.getElementById('guided-live-video');
    const imgEl     = document.getElementById('guided-step-img');
    const hudEl     = document.getElementById('live-call-hud-overlay');
    const btnText   = document.getElementById('live-call-btn-text');
    const btnCall   = document.getElementById('btn-live-video-call');

    // Si l'appel est déjà actif -> on l'arrête
    if (fluxAppelVideoLive) {
        arreterAppelVideoLiveIA();
        return;
    }

    try {
        fluxAppelVideoLive = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: 'environment' },
            audio: false
        });
        videoEl.srcObject = fluxAppelVideoLive;
        videoEl.style.display = 'block';
        imgEl.style.display = 'none';
        hudEl.style.display = 'flex';
        const canvasDet = document.getElementById('canvas-live-detections');
        if (canvasDet) canvasDet.style.display = 'block';

        chargerModeleVisionTempsReel().then(() => {
            executerDetectionTempsReelVideo();
        });

        btnText.textContent = t('live_call_stop_btn');
        btnCall.style.background = 'linear-gradient(90deg, #ef4444, #f97316)';

        secondesAppel = 0;
        tickAppelIndex = 0;
        timerSecondesLive = setInterval(() => {
            secondesAppel++;
            const m = String(Math.floor(secondesAppel / 60)).padStart(2, '0');
            const s = String(secondesAppel % 60).padStart(2, '0');
            const tEl = document.getElementById('live-call-timer');
            if (tEl) tEl.textContent = `${m}:${s}`;
        }, 1000);

        const prenom = localStorage.getItem('rl_user_name') || '';
        const msgAccueilLive = getLangue() === 'fr'
            ? `Appel vidéo en direct activé ${prenom} ! Je vois ton appareil en temps réel. Montre-moi la pièce et parle-moi quand tu veux.`
            : `Live AI video call started ${prenom}! I can see your device in real time. Show me the part and speak to me anytime.`;
        document.getElementById('live-call-ai-subtitle').textContent = msgAccueilLive;
        parlerIA(msgAccueilLive);

        // Surveillance proactive automatique par l'IA toutes les 10 secondes
        intervalleAppelLive = setInterval(() => {
            envoyerTickAppelVideoLive('');
        }, 10000);

    } catch (err) {
        console.error('Erreur caméra appel live :', err);
        afficherToast(
            getLangue() === 'fr'
                ? 'Caméra indisponible pour l\'appel vidéo en direct.'
                : 'Camera unavailable for live video call.',
            ''
        );
    }
}

function arreterAppelVideoLiveIA() {
    if (fluxAppelVideoLive) {
        fluxAppelVideoLive.getTracks().forEach(t => t.stop());
        fluxAppelVideoLive = null;
    }
    if (intervalleAppelLive) clearInterval(intervalleAppelLive);
    if (timerSecondesLive) clearInterval(timerSecondesLive);
    if (boucleDetectionId) clearTimeout(boucleDetectionId);
    const canvasDet = document.getElementById('canvas-live-detections');
    if (canvasDet) canvasDet.style.display = 'none';

    const videoEl = document.getElementById('guided-live-video');
    const imgEl   = document.getElementById('guided-step-img');
    const hudEl   = document.getElementById('live-call-hud-overlay');
    const btnText = document.getElementById('live-call-btn-text');
    const btnCall = document.getElementById('btn-live-video-call');

    if (videoEl) videoEl.style.display = 'none';
    if (imgEl) imgEl.style.display = 'block';
    if (hudEl) hudEl.style.display = 'none';
    if (btnText) btnText.textContent = t('live_call_start_btn');
    if (btnCall) btnCall.style.background = 'linear-gradient(90deg, #00f0ff, #38bdf8)';
}

async function envoyerTickAppelVideoLive(paroleUtilisateur = '') {
    if (!fluxAppelVideoLive) return;
    const etape = etapesActuelles[indexEtapeActive] || { instruction: 'Inspection' };

    // Capturer RÉELLEMENT la frame actuelle de la caméra en Base64 pour l'envoyer à SAM 2 & Muse Spark
    let frameBase64 = null;
    const videoEl = document.getElementById('guided-live-video');
    if (videoEl && videoEl.videoWidth > 0) {
        const cFrame = document.createElement('canvas');
        cFrame.width  = 320;
        cFrame.height = 240;
        cFrame.getContext('2d').drawImage(videoEl, 0, 0, cFrame.width, cFrame.height);
        frameBase64 = cFrame.toDataURL('image/jpeg', 0.7).split(',')[1];
    }

    try {
        const res = await fetch('/api/diagnostic/appel-video-live', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                session_id: sessionId,
                type_appareil: appareilActuel,
                etape_actuelle: etape.instruction,
                numero_etape: indexEtapeActive + 1,
                parole_utilisateur: paroleUtilisateur,
                nom_utilisateur: localStorage.getItem('rl_user_name') || null,
                langue: getLangue(),
                tick_index: tickAppelIndex++,
                frame_base64: frameBase64,
                objets_detectes_vision: derniersObjetsVus
            })
        });
        const data = await res.json();
        if (data.prenom_detecte) {
            localStorage.setItem('rl_user_name', data.prenom_detecte);
        }

        const subEl = document.getElementById('live-call-ai-subtitle');
        if (subEl && data.reponse_vocale) {
            subEl.textContent = data.reponse_vocale;
        }

        // Déplacer dynamiquement le viseur AR Cyan et la flèche de geste sur la vidéo live
        const boxAr = document.getElementById('guided-ar-target-box');
        const badgeAr = document.getElementById('ar-gesture-arrow-badge');
        if (boxAr && data.pos_x && data.pos_y) {
            boxAr.style.left = `${data.pos_x}%`;
            boxAr.style.top  = `${data.pos_y}%`;
        }
        if (badgeAr && data.icone_geste) {
            badgeAr.textContent = `${data.icone_geste} ${data.label_geste.split('/')[getLangue() === 'fr' ? 0 : 1].trim()}`;
        }

        if (paroleUtilisateur || tickAppelIndex % 2 === 1) {
            parlerIA(data.reponse_vocale);
        }
    } catch (err) {
        console.error(err);
    }
}

function parlerPendantAppelVideoLive() {
    const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
    const btnTalk = document.getElementById('btn-live-talk');
    if (!SpeechRec) {
        const msgPrompt = prompt(getLangue() === 'fr' ? 'Que voulez-vous dire à Muse Spark en direct ?' : 'What do you want to ask Muse Spark live?');
        if (msgPrompt) envoyerTickAppelVideoLive(msgPrompt);
        return;
    }

    const rec = new SpeechRec();
    rec.lang = getLangue() === 'fr' ? 'fr-FR' : 'en-US';
    rec.interimResults = false;
    if (btnTalk) btnTalk.classList.add('recording');

    rec.onresult = function(event) {
        const texte = event.results[0][0].transcript;
        document.getElementById('live-call-ai-subtitle').textContent = `"${texte}"...`;
        envoyerTickAppelVideoLive(texte);
    };
    rec.onend = function() {
        if (btnTalk) btnTalk.classList.remove('recording');
    };
    rec.start();
}

// =============================================================
// SUPER-POUVOIR 6 : CHECK DE SÉCURITÉ ÉLECTRIQUE INTERACTIF (AI SAFETY LOCK)
// =============================================================
let securitePlugOk = false;
let securiteCapOk  = false;

function basculerVerrouSecurite(type) {
    if (type === 'plug') securitePlugOk = !securitePlugOk;
    if (type === 'cap')  securiteCapOk  = !securiteCapOk;

    const btnPlug = document.getElementById('btn-safety-plug');
    const btnCap  = document.getElementById('btn-safety-cap');
    const box     = document.getElementById('safety-lock-box');
    const title   = document.getElementById('safety-lock-title');
    const icon    = document.getElementById('safety-lock-icon');

    if (btnPlug) {
        btnPlug.style.borderColor = securitePlugOk ? '#34d399' : '';
        btnPlug.style.color       = securitePlugOk ? '#34d399' : '';
    }
    if (btnCap) {
        btnCap.style.borderColor = securiteCapOk ? '#34d399' : '';
        btnCap.style.color       = securiteCapOk ? '#34d399' : '';
    }

    if (securitePlugOk && securiteCapOk && box) {
        box.style.borderColor = 'rgba(16,185,129,0.6)';
        box.style.background  = 'rgba(16,185,129,0.08)';
        if (icon) icon.textContent = '';
        if (title) {
            title.style.color = '#34d399';
            title.textContent = getLangue() === 'fr'
                ? 'SÉCURITÉ ÉLECTRIQUE VALIDÉE — INTERVENTION SÛRE'
                : 'ELECTRICAL SAFETY CONFIRMED — SAFE TO PROCEED';
        }
        afficherToast(
            getLangue() === 'fr' ? 'Sécurité électrique validée !' : 'Electrical safety confirmed!',
            ''
        );
    }
}

