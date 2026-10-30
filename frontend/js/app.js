// =============================================================
// app.js — Gestion globale : Profil Utilisateur, Langue EN/FR & Accueil
// =============================================================

// --- 1. GESTION DE L'IDENTIFIANT UTILISATEUR PERSONNEL ---
function getUtilisateurId() {
    const googleUid = localStorage.getItem('repairlens_google_uid');
    if (googleUid) return googleUid;
    let uid = localStorage.getItem('repairlens_uid');
    if (!uid) {
        uid = 'user_' + Math.random().toString(36).substring(2, 10) + '_' + Date.now().toString(36);
        localStorage.setItem('repairlens_uid', uid);
    }
    return uid;
}

function estConnecteGoogle() {
    return Boolean(localStorage.getItem('repairlens_google_uid'));
}

function getNomUtilisateur() {
    return localStorage.getItem('repairlens_username') || localStorage.getItem('rl_user_name') || 'Technicien';
}

function getInitialesUtilisateur() {
    const nom = getNomUtilisateur().trim();
    return nom ? nom.substring(0, 2).toUpperCase() : 'RL';
}

// --- GOOGLE SIGN-IN ---
async function initGoogleAuth() {
    try {
        const res = await fetch('/api/auth/config');
        const data = await res.json();
        if (!data.google_client_id) return;
        window._googleClientId = data.google_client_id;

        if (typeof google === 'undefined' || !google.accounts) return;

        google.accounts.id.initialize({
            client_id: data.google_client_id,
            callback: onGoogleSignIn,
            auto_select: false
        });

        const btnContainer = document.getElementById('google-signin-btn');
        if (btnContainer && !estConnecteGoogle()) {
            google.accounts.id.renderButton(btnContainer, {
                theme: 'filled_black',
                size: 'medium',
                shape: 'pill',
                text: 'signin_with',
                locale: getLangue() === 'fr' ? 'fr' : 'en'
            });
        }
    } catch (e) {
        console.log('[AUTH] Google Sign-In not available:', e.message);
    }
}

async function onGoogleSignIn(response) {
    try {
        const oldUid = localStorage.getItem('repairlens_uid') || '';
        const res = await fetch('/api/auth/google', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ credential: response.credential, old_uid: oldUid })
        });
        const data = await res.json();
        if (!res.ok || !data.utilisateur_id) {
            console.error('[AUTH] Google login failed:', data);
            return;
        }

        localStorage.setItem('repairlens_google_uid', data.utilisateur_id);
        localStorage.setItem('repairlens_username', data.nom);
        localStorage.setItem('rl_user_name', data.nom.split(' ')[0]);
        if (data.email) localStorage.setItem('repairlens_email', data.email);
        if (data.photo) localStorage.setItem('repairlens_photo', data.photo);

        actualiserEtatConnexion();
        const isFr = getLangue() === 'fr';
        afficherToast(isFr ? `Bienvenue ${data.nom.split(' ')[0]} !` : `Welcome ${data.nom.split(' ')[0]}!`);

        if (typeof chargerPageAccueil === 'function') chargerPageAccueil();
        if (typeof chargerHistorique === 'function') chargerHistorique();
    } catch (e) {
        console.error('[AUTH] Error:', e);
    }
}

function deconnexionGoogle() {
    localStorage.removeItem('repairlens_google_uid');
    localStorage.removeItem('repairlens_email');
    localStorage.removeItem('repairlens_photo');
    localStorage.removeItem('repairlens_username');
    localStorage.removeItem('rl_user_name');
    localStorage.removeItem('repairlens_uid');

    if (typeof google !== 'undefined' && google.accounts) {
        google.accounts.id.disableAutoSelect();
    }
    actualiserEtatConnexion();
    const isFr = getLangue() === 'fr';
    afficherToast(isFr ? 'Deconnecte. Ton historique reste accessible en te reconnectant.' : 'Signed out. Your history is saved — sign in again to access it.');
    if (typeof chargerPageAccueil === 'function') chargerPageAccueil();
    if (typeof chargerHistorique === 'function') chargerHistorique();
}

function actualiserEtatConnexion() {
    const connected = estConnecteGoogle();
    const btnGoogle = document.getElementById('google-signin-btn');
    const zoneUser = document.getElementById('google-user-info');
    const avatarBadge = document.getElementById('user-avatar-badge');

    if (connected) {
        const nom = getNomUtilisateur();
        const photo = localStorage.getItem('repairlens_photo');

        if (btnGoogle) btnGoogle.style.display = 'none';
        if (zoneUser) {
            zoneUser.style.display = 'flex';
            zoneUser.innerHTML = `
                ${photo
                    ? `<img src="${photo}" alt="${nom}" class="google-avatar" referrerpolicy="no-referrer">`
                    : `<span class="avatar-btn">${getInitialesUtilisateur()}</span>`}
                <button type="button" class="google-logout-btn" onclick="deconnexionGoogle()" title="${getLangue() === 'fr' ? 'Se deconnecter' : 'Sign out'}">
                    <svg style="width:14px;height:14px;fill:currentColor;" viewBox="0 0 24 24"><path d="M17 7l-1.41 1.41L18.17 11H8v2h10.17l-2.58 2.58L17 17l5-5zM4 5h8V3H4c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h8v-2H4V5z"/></svg>
                </button>
            `;
        }
        if (avatarBadge) {
            if (photo) {
                avatarBadge.innerHTML = `<img src="${photo}" alt="${nom}" class="google-avatar" referrerpolicy="no-referrer">`;
            } else {
                avatarBadge.textContent = getInitialesUtilisateur();
            }
        }
    } else {
        if (btnGoogle) btnGoogle.style.display = 'block';
        if (zoneUser) { zoneUser.style.display = 'none'; zoneUser.innerHTML = ''; }
        if (avatarBadge) avatarBadge.textContent = 'RL';
        initGoogleAuth();
    }
}

// Notification Toast élégante intégrée à l'application (remplace alert())
function afficherToast(message, icone = '') {
    const existant = document.querySelector('.rl-toast');
    if (existant) existant.remove();

    const toast = document.createElement('div');
    toast.className = 'rl-toast';
    toast.innerHTML = `<span>${icone}</span><span>${message}</span>`;
    document.body.appendChild(toast);

    setTimeout(() => {
        if (toast.parentNode) toast.remove();
    }, 3200);
}

// --- 2. SYSTÈME DE LANGUE BILINGUE (EN | FR) ---
const TRADUCTIONS = {
    en: {
        hero_1: "Understand.",
        hero_2: "Diagnose.",
        hero_3: "Repair.",
        hero_desc: "Your AI assistant for understanding and repairing the devices around you.",
        btn_start_repair: "Start a repair",
        active_session: "ACTIVE SESSION",
        done_suffix: "Done",
        recent_repairs: "Recent Repairs",
        see_all: "See All",
        no_recent: "No repair sessions yet. Tap 'Start a repair' to inspect your first device.",
        status_completed: "COMPLETED",
        status_in_progress: "IN PROGRESS",
        issue_prefix: "Issue:",
        step_of: "Step",
        of_word: "of",
        nav_home: "HOME",
        nav_history: "HISTORY",
        nav_profile: "PROFILE",
        // New Inspection
        new_inspection_title: "New Inspection",
        what_to_inspect: "What would you like to inspect?",
        use_camera_title: "Use camera",
        use_camera_sub: "Real-time AR component detection and diagnosis.",
        upload_photo_title: "Upload a photo",
        upload_photo_sub: "Analyze a saved image from your gallery.",
        upload_video_title: "Analyze a video",
        upload_video_sub: "Detect moving parts, vibrations or blinking LED error codes.",
        describe_prob_title: "Describe a problem",
        describe_prob_sub: "Explain the issue to the AI assistant.",
        privacy_title: "PRIVACY & SAFETY",
        privacy_text: "Camera data is processed to identify components. Always ensure devices are disconnected from power before attempting any repairs.",
        device_label: "Device Name (Auto-detected from photo)",
        device_placeholder: "AI detects your device automatically from the photo...",
        issue_label: "Observed Issue (Auto-detected or describe)",
        issue_placeholder: "AI spots visible damage or describe what's wrong...",
        // AI Vision Active
        ai_vision_active: "AI VISION ACTIVE",
        detected_comp: "DETECTED COMPONENT",
        confidence_suffix: "CONFIDENCE",
        btn_inspect_problems: "Inspect for problems",
        btn_explain_comp: "Explain this component",
        other_components: "OTHER COMPONENTS DETECTED",
        ask_anything_placeholder: "Ask anything about this device...",
        // AI Diagnosis
        ai_diagnosis_title: "AI Diagnosis",
        possible_cause: "POSSIBLE CAUSE",
        medium_confidence: "AI HYPOTHESIS",
        needs_verification: "• Possible explanation — needs verification",
        technical_insight: "TECHNICAL INSIGHT",
        what_to_check: "What to check next",
        danger_high_voltage: "DANGER: HIGH VOLTAGE",
        danger_text: "Never touch exposed internal wiring while the device is plugged in. Always disconnect power before inspection.",
        btn_start_guided: "Start guided inspection",
        btn_ask_followup: "Ask a follow-up question",
        // Guided Inspection
        guided_inspection: "GUIDED INSPECTION",
        safety_first: "SAFETY FIRST",
        safety_step_text: "Disconnect the device from power before inspecting electrical connections.",
        task_checklist: "TASK CHECKLIST",
        btn_back: "Back",
        btn_next_step: "Next Step",
        btn_finish_repair: "Complete Repair",
        ask_ai_help: "Ask AI for help",
        tap_to_segment_hint: "Tap anywhere on the image to isolate a specific part",
        btn_verify_step_photo: "Verify my step with camera (Before / After)",
        // History & Profile
        repair_history_title: "Repair History",
        search_placeholder: "Search your repairs...",
        filter_all: "All Sessions",
        filter_progress: "In Progress",
        filter_completed: "Completed",
        profile_title: "Technician Profile",
        your_name_label: "YOUR NAME / PSEUDO",
        save_profile_btn: "Save Profile",
        // Extra UI & Superpowers
        voice_btn: "Voice",
        listen_noise_btn: "Listen to Noise",
        capture_frame_btn: "Capture Frame",
        ai_scan_corners: "360° Full Scan",
        rotate_90: "↻ Rotate 90°",
        reset_view: "Reset",
        btn_explain_comp: "What does it look like?",
        screw_tray_btn: "Screw & Cable Memory Tray (Disassembly Map)",
        screw_tray_header: "DISASSEMBLY MEMORY MAP (NEVER LOSE A SCREW)",
        beginner_guide_header: "VISUAL GUIDE — WHAT THIS PART LOOKS LIKE",
        zoom_your_photo: "Zoom on your photo",
        shape_color_label: "Shape & Color:",
        simple_role_label: "Simple Role:",
        spot_damage_label: "How to spot damage:",
        part_to_buy_label: "Part to buy:",
        memory_banner_header: "SAVED REPAIR PROGRESS — WELCOME BACK!",
        eco_card_header: "REPAIRABILITY, TOOLS & ECO-IMPACT",
        money_saved_label: "Money Saved",
        ewaste_avoided_label: "E-Waste Avoided",
        est_time_label: "Est. Time",
        required_tools_label: "REQUIRED TOOLS BEFORE OPENING:",
        followup_chat_placeholder: "Describe what you observe...",
        btn_not_understood: "I don't understand this step",
        micro_actions_header: "STEP BREAKDOWN",
        guided_beginner_btn: "Not a technician? Show me what this part looks like!",
        guided_visual_header: "VISUAL PART IDENTIFIER (STEP-BY-STEP)",
        export_pdf_btn: "Export Repair Passport (PDF)",
        ask_ai_help: "Need help? Ask a question",
        guided_chat_placeholder: "Explain what is still not working...",
        followup_questions_kicker: "QUICK FOLLOW-UP QUESTIONS",
        followup_questions_title: "More details needed for accurate diagnosis",
        your_answer_placeholder: "Your answer...",
        submit_answers_btn: "Submit Answers & Generate Diagnosis",
        mark_completed_now_btn: "Issue Resolved — Complete Repair",
        live_call_start_btn: "Live AI Call",
        live_call_stop_btn: "End Live Call",
        live_talk_btn: "Speak to AI Co-Pilot",
        safety_plug_btn: "Power Unplugged",
        safety_cap_btn: "Hands Dry / Insulated"
    },
    fr: {
        hero_1: "Comprendre.",
        hero_2: "Diagnostiquer.",
        hero_3: "Réparer.",
        hero_desc: "Votre assistant IA pour comprendre et réparer les appareils qui vous entourent.",
        btn_start_repair: "Démarrer une réparation",
        active_session: "SESSION ACTIVE",
        done_suffix: "Terminé",
        recent_repairs: "Réparations récentes",
        see_all: "Tout voir",
        no_recent: "Aucune réparation enregistrée. Cliquez sur 'Démarrer une réparation' pour commencer.",
        status_completed: "TERMINÉ",
        status_in_progress: "EN COURS",
        issue_prefix: "Panne :",
        step_of: "Étape",
        of_word: "sur",
        nav_home: "ACCUEIL",
        nav_history: "HISTORIQUE",
        nav_profile: "PROFIL",
        // New Inspection
        new_inspection_title: "Nouvelle Inspection",
        what_to_inspect: "Que souhaitez-vous inspecter ?",
        use_camera_title: "Utiliser la caméra",
        use_camera_sub: "Détection AR des composants et diagnostic en direct.",
        upload_photo_title: "Importer une photo",
        upload_photo_sub: "Analyser une image enregistrée depuis votre galerie.",
        upload_video_title: "Analyser une vidéo",
        upload_video_sub: "Détecter un blocage mécanique, bruit ou voyant qui clignote.",
        describe_prob_title: "Décrire un problème",
        describe_prob_sub: "Expliquer la panne à l'assistant vocal ou par écrit.",
        privacy_title: "CONFIDENTIALITÉ & SÉCURITÉ",
        privacy_text: "Les images servent à identifier les composants. Débranchez toujours vos appareils électriques avant toute manipulation.",
        device_label: "Nom de l'appareil (Détecté auto par l'IA)",
        device_placeholder: "L'IA reconnaît automatiquement l'appareil dès que vous mettez une photo...",
        issue_label: "Problème observé (Détecté auto ou précisez)",
        issue_placeholder: "L'IA détecte les dégâts visibles (ou décrivez un bruit / symptôme)...",
        // AI Vision Active
        ai_vision_active: "VISION IA ACTIVE",
        detected_comp: "COMPOSANT DÉTECTÉ",
        confidence_suffix: "CONFIANCE",
        btn_inspect_problems: "Diagnostiquer la panne",
        btn_explain_comp: "Expliquer ce composant",
        other_components: "AUTRES COMPOSANTS DÉTECTÉS",
        ask_anything_placeholder: "Posez une question sur cet appareil...",
        // AI Diagnosis
        ai_diagnosis_title: "Diagnostic IA",
        possible_cause: "CAUSE PROBABLE",
        medium_confidence: "HYPOTHÈSE IA",
        needs_verification: "• Explication probable — vérification requise",
        technical_insight: "ANALYSE TECHNIQUE",
        what_to_check: "Vérifications recommandées",
        danger_high_voltage: "DANGER : HAUTE TENSION",
        danger_text: "Ne touchez jamais les câbles internes lorsque l'appareil est branché. Coupez toujours l'alimentation avant d'intervenir.",
        btn_start_guided: "Démarrer l'inspection guidée",
        btn_ask_followup: "Poser une question à l'IA",
        // Guided Inspection
        guided_inspection: "INSPECTION GUIDÉE",
        safety_first: "SÉCURITÉ D'ABORD",
        safety_step_text: "Débranchez l'appareil du secteur avant d'inspecter les connexions électriques.",
        task_checklist: "LISTE DES VÉRIFICATIONS",
        btn_back: "Précédent",
        btn_next_step: "Étape suivante",
        btn_finish_repair: "Marquer comme résolu",
        ask_ai_help: "Demander de l'aide",
        tap_to_segment_hint: "Touchez n'importe quelle pièce sur l'image pour l'isoler",
        btn_verify_step_photo: "Vérifier mon étape par photo (Avant / Après)",
        // History & Profile
        repair_history_title: "Historique de réparation",
        search_placeholder: "Rechercher une réparation...",
        filter_all: "Toutes",
        filter_progress: "En cours",
        filter_completed: "Terminées",
        profile_title: "Profil Technicien",
        your_name_label: "VOTRE PRÉNOM / PSEUDO",
        save_profile_btn: "Enregistrer le profil",
        // Extra UI & Superpowers
        voice_btn: "Voix",
        listen_noise_btn: "Écouter le bruit",
        capture_frame_btn: "Capturer l'image",
        ai_scan_corners: "Scanner à 360°",
        rotate_90: "↻ Pivoter 90°",
        reset_view: "Réinitialiser",
        btn_explain_comp: "À quoi ça ressemble ?",
        screw_tray_btn: "Trieur de Vis & Câbles (Carte de Démontage)",
        screw_tray_header: "CARTE MÉMOIRE DE DÉMONTAGE (NE PERDEZ AUCUNE VIS)",
        beginner_guide_header: "GUIDE VISUEL — À QUOI RESSEMBLE CETTE PIÈCE",
        zoom_your_photo: "Zoom sur votre photo",
        shape_color_label: "Forme & Couleur :",
        simple_role_label: "Rôle simple :",
        spot_damage_label: "Signes de panne à l'œil nu :",
        part_to_buy_label: "Pièce à acheter :",
        memory_banner_header: "REPRISE DE VOTRE RÉPARATION — BON RETOUR !",
        eco_card_header: "RÉPARABILITÉ, OUTILS & IMPACT ÉCOLOGIQUE",
        money_saved_label: "Économie réalisée",
        ewaste_avoided_label: "Déchets évités",
        est_time_label: "Temps estimé",
        required_tools_label: "OUTILS REQUIS AVANT D'OUVRIR :",
        followup_chat_placeholder: "Décrivez ce que vous observez...",
        btn_not_understood: "Je n'ai pas compris cette étape",
        micro_actions_header: "DÉTAIL DE L'ÉTAPE",
        guided_beginner_btn: "Pas technicien ? Montre-moi à quoi ressemble cette pièce !",
        guided_visual_header: "IDENTIFICATEUR VISUEL DE PIÈCE",
        export_pdf_btn: "Passeport de Réparation (PDF)",
        ask_ai_help: "Besoin d'aide ? Poser une question",
        guided_chat_placeholder: "Expliquez ce qui ne fonctionne toujours pas...",
        followup_questions_kicker: "QUESTIONS DE PRÉCISION",
        followup_questions_title: "Quelques précisions pour affiner le diagnostic",
        your_answer_placeholder: "Votre réponse...",
        submit_answers_btn: "Envoyer mes réponses & Générer le diagnostic",
        mark_completed_now_btn: "Problème résolu — Terminer la réparation",
        live_call_start_btn: "Appel Vidéo en Direct",
        live_call_stop_btn: "Quitter l'appel",
        live_talk_btn: "Parler en direct",
        safety_plug_btn: "Prise débranchée",
        safety_cap_btn: "Mains sèches / Isolées"
    }
};

function getLangue() {
    return localStorage.getItem('repairlens_lang') || 'en';
}

function t(cle) {
    const lang = getLangue();
    return (TRADUCTIONS[lang] && TRADUCTIONS[lang][cle]) || TRADUCTIONS['en'][cle] || cle;
}

function basculerLangue() {
    const actuelle = getLangue();
    const nouvelle = actuelle === 'en' ? 'fr' : 'en';
    localStorage.setItem('repairlens_lang', nouvelle);
    appliquerTraductionsPage();
    if (typeof rafraichirVueActuelle === 'function') {
        rafraichirVueActuelle();
    }
}

function appliquerTraductionsPage() {
    const lang = getLangue();
    const btnLang = document.getElementById('btn-lang-switch');
    if (btnLang) {
        btnLang.textContent = lang === 'en' ? 'EN | FR' : 'FR | EN';
    }

    document.querySelectorAll('[data-i18n]').forEach(el => {
        const cle = el.getAttribute('data-i18n');
        el.textContent = t(cle);
    });

    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
        const cle = el.getAttribute('data-i18n-placeholder');
        el.placeholder = t(cle);
    });

    const avatarEl = document.getElementById('user-avatar-badge');
    if (avatarEl) {
        avatarEl.textContent = getInitialesUtilisateur();
    }
}

// Formater une date SQL en format court ("TODAY", "OCT 23")
function formaterDateCourte(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return '';
    const auj = new Date();
    if (d.toDateString() === auj.toDateString()) {
        return getLangue() === 'fr' ? "AUJOURD'HUI" : 'TODAY';
    }
    return d.toLocaleDateString(getLangue() === 'fr' ? 'fr-FR' : 'en-US', {
        month: 'short',
        day: 'numeric'
    }).toUpperCase();
}

// =============================================================
// LOGIQUE DE LA PAGE D'ACCUEIL (index.html)
// Charge uniquement les vraies données PostgreSQL de l'utilisateur
// =============================================================
async function chargerPageAccueil() {
    appliquerTraductionsPage();
    const zoneActive = document.getElementById('home-active-session');
    const zoneRecent = document.getElementById('home-recent-list');
    if (!zoneActive && !zoneRecent) return;

    try {
        const uid = getUtilisateurId();
        const res = await fetch('/api/history/', {
            headers: { 'X-Utilisateur-Id': uid }
        });
        const data = await res.json();
        const sessions = data.sessions || [];

        // 1. Afficher la session active (en_cours) s'il y en a une
        const sessionEnCours = sessions.find(s => s.statut === 'en_cours');
        if (sessionEnCours && zoneActive) {
            const total = sessionEnCours.total_etapes || 0;
            const faites = sessionEnCours.etapes_completes || 0;
            const pct = total > 0 ? Math.round((faites / total) * 100) : 25;

            zoneActive.style.display = 'flex';
            zoneActive.href = `/static/camera.html?session_id=${sessionEnCours.id}`;
            zoneActive.innerHTML = `
                <div>
                    <div class="active-session-label">${t('active_session')}</div>
                    <div class="active-session-title">${sessionEnCours.type_appareil}</div>
                </div>
                <span class="pill-cyan">${pct}% ${t('done_suffix')}</span>
            `;
        } else if (zoneActive) {
            zoneActive.style.display = 'none';
        }

        // 2. Afficher les réparations récentes (si la section est présente)
        if (zoneRecent) {
            if (sessions.length === 0) {
                zoneRecent.innerHTML = `
                    <div class="empty-box">
                        <div style="margin-bottom:8px;"><svg style="width:28px;height:28px;fill:var(--cyan);" viewBox="0 0 24 24"><path d="M22.7 19l-9.1-9.1c.9-2.3.4-5-1.5-6.9-2-2-5-2.4-7.4-1.3L9 6 6 9 1.6 4.7C.4 7.1.9 10.1 2.9 12.1c1.9 1.9 4.6 2.4 6.9 1.5l9.1 9.1c.4.4 1 .4 1.4 0l2.3-2.3c.5-.4.5-1.1.1-1.4z"/></svg></div>
                        <p>${t('no_recent')}</p>
                    </div>
                `;
            } else {
                zoneRecent.innerHTML = sessions.slice(0, 4).map(s => {
                    const estResolu = s.statut === 'resolu';
                    const badgeClass = estResolu ? 'status-completed' : 'status-progress';
                    const badgeTexte = estResolu ? `✔ ${t('status_completed')}` : `• ${t('status_in_progress')}`;
                    const thumbHtml = s.image_miniature
                        ? `<img src="data:image/jpeg;base64,${s.image_miniature}" class="repair-thumb" alt="${s.type_appareil}">`
                        : `<div class="repair-thumb"><svg style="width:20px;height:20px;fill:var(--cyan);" viewBox="0 0 24 24"><path d="M22.7 19l-9.1-9.1c.9-2.3.4-5-1.5-6.9-2-2-5-2.4-7.4-1.3L9 6 6 9 1.6 4.7C.4 7.1.9 10.1 2.9 12.1c1.9 1.9 4.6 2.4 6.9 1.5l9.1 9.1c.4.4 1 .4 1.4 0l2.3-2.3c.5-.4.5-1.1.1-1.4z"/></svg></div>`;

                    const total = s.total_etapes || 0;
                    const faites = s.etapes_completes || 0;
                    const infoDroite = total > 0
                        ? `<span class="step-counter-text">${t('step_of')} ${Math.min(faites + 1, total)} ${t('of_word')} ${total}</span>`
                        : '';

                    return `
                        <div class="repair-card" onclick="window.location.href='/static/camera.html?session_id=${s.id}'">
                            ${thumbHtml}
                            <div class="repair-info">
                                <div class="repair-top-line">
                                    <span class="repair-device-name">${s.type_appareil}</span>
                                    <span class="repair-date">${formaterDateCourte(s.date_creation)}</span>
                                </div>
                                <div class="repair-issue">
                                    ${t('issue_prefix')} ${s.probleme_detecte || 'Inspection visuelle'}
                                </div>
                                <div class="repair-bottom-line">
                                    <span class="status-badge ${badgeClass}">${badgeTexte}</span>
                                    ${infoDroite}
                                </div>
                            </div>
                        </div>
                    `;
                }).join('');
            }
        }

    } catch (err) {
        console.error('Erreur chargement accueil :', err);
    }
}

window.rafraichirVueActuelle = function() {
    if (document.getElementById('home-recent-list')) {
        chargerPageAccueil();
    }
};

document.addEventListener('DOMContentLoaded', () => {
    chargerPageAccueil();
    actualiserEtatConnexion();
    if (!estConnecteGoogle()) initGoogleAuth();
});
