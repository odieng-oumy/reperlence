// =============================================================
// history.js — Logique de la page Repair History & Profile
// Zéro fausse donnée : 100% synchronisé avec PostgreSQL par utilisateur
// =============================================================

let toutesMesSessions = [];
let filtreStatutActif = 'tous';

async function initialiserPageHistorique() {
    appliquerTraductionsPage();

    // Vérifier si l'URL demande d'ouvrir directement l'onglet Profile (?tab=profile)
    const params = new URLSearchParams(window.location.search);
    if (params.get('tab') === 'profile') {
        afficherOngletHistory('profile');
    }

    await chargerMesSessionsPostgreSQL();
    remplirInfosProfil();
}

function afficherOngletHistory(onglet) {
    const vueHist = document.getElementById('view-history');
    const vueProf = document.getElementById('view-profile');
    const tabHist = document.getElementById('nav-tab-history');
    const tabProf = document.getElementById('nav-tab-profile');

    if (onglet === 'profile') {
        vueHist.style.display = 'none';
        vueProf.style.display = 'block';
        tabHist.classList.remove('active');
        tabProf.classList.add('active');
        remplirInfosProfil();
    } else {
        vueHist.style.display = 'block';
        vueProf.style.display = 'none';
        tabHist.classList.add('active');
        tabProf.classList.remove('active');
    }
}

async function chargerMesSessionsPostgreSQL() {
    try {
        const uid = getUtilisateurId();
        const res = await fetch('/api/history/', {
            headers: { 'X-Utilisateur-Id': uid }
        });
        const data = await res.json();
        toutesMesSessions = data.sessions || [];
        filtrerEtAfficherHistorique();
        remplirInfosProfil();
    } catch (err) {
        console.error('Erreur chargement historique :', err);
    }
}

function changerFiltreStatut(statut) {
    filtreStatutActif = statut;
    document.getElementById('pill-all').classList.toggle('active', statut === 'tous');
    document.getElementById('pill-progress').classList.toggle('active', statut === 'en_cours');
    document.getElementById('pill-completed').classList.toggle('active', statut === 'resolu');
    filtrerEtAfficherHistorique();
}

function filtrerEtAfficherHistorique() {
    const zone = document.getElementById('history-sessions-list');
    const q = (document.getElementById('input-search-history').value || '').toLowerCase().trim();

    const filtrees = toutesMesSessions.filter(s => {
        const matchStatut = filtreStatutActif === 'tous' || s.statut === filtreStatutActif;
        const texte = `${s.type_appareil || ''} ${s.probleme_detecte || ''} ${s.marque || ''}`.toLowerCase();
        const matchRecherche = !q || texte.includes(q);
        return matchStatut && matchRecherche;
    });

    if (filtrees.length === 0) {
        zone.innerHTML = `
            <div class="empty-box">
                <div style="margin-bottom:10px;"><svg style="width:32px;height:32px;fill:var(--cyan);" viewBox="0 0 24 24"><path d="M22.7 19l-9.1-9.1c.9-2.3.4-5-1.5-6.9-2-2-5-2.4-7.4-1.3L9 6 6 9 1.6 4.7C.4 7.1.9 10.1 2.9 12.1c1.9 1.9 4.6 2.4 6.9 1.5l9.1 9.1c.4.4 1 .4 1.4 0l2.3-2.3c.5-.4.5-1.1.1-1.4z"/></svg></div>
                <p>${t('no_recent')}</p>
            </div>
        `;
        return;
    }

    zone.innerHTML = filtrees.map(s => {
        const estResolu = s.statut === 'resolu';
        const badgeClass = estResolu ? 'status-completed' : 'status-progress';
        const badgeTexte = estResolu ? `✔ ${t('status_completed')}` : `• ${t('status_in_progress')}`;
        const thumbHtml  = s.image_miniature
            ? `<img src="data:image/jpeg;base64,${s.image_miniature}" class="repair-thumb" alt="${s.type_appareil}">`
            : `<div class="repair-thumb"><svg style="width:20px;height:20px;fill:var(--cyan);" viewBox="0 0 24 24"><path d="M22.7 19l-9.1-9.1c.9-2.3.4-5-1.5-6.9-2-2-5-2.4-7.4-1.3L9 6 6 9 1.6 4.7C.4 7.1.9 10.1 2.9 12.1c1.9 1.9 4.6 2.4 6.9 1.5l9.1 9.1c.4.4 1 .4 1.4 0l2.3-2.3c.5-.4.5-1.1.1-1.4z"/></svg></div>`;

        const total  = s.total_etapes || 0;
        const faites = s.etapes_completes || 0;
        const infoEtape = total > 0
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
                        ${t('issue_prefix')} ${s.probleme_detecte || 'Inspection'}
                    </div>
                    <div class="repair-bottom-line">
                        <span class="status-badge ${badgeClass}">${badgeTexte}</span>
                        <div style="display:flex; align-items:center; gap:8px;">
                            ${infoEtape}
                            <button type="button" class="delete-mini-btn" title="Delete session"
                                    onclick="event.stopPropagation(); supprimerSessionHistorique(${s.id})">
                                <svg style="width:14px;height:14px;fill:currentColor;" viewBox="0 0 24 24"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

async function supprimerSessionHistorique(id) {
    try {
        await fetch(`/api/history/${id}`, {
            method: 'DELETE',
            headers: { 'X-Utilisateur-Id': getUtilisateurId() }
        });
        await chargerMesSessionsPostgreSQL();
    } catch (err) {
        console.error(err);
    }
}

function remplirInfosProfil() {
    const nom = getNomUtilisateur();
    const uid = getUtilisateurId();

    document.getElementById('profile-big-initials').textContent = getInitialesUtilisateur();
    document.getElementById('profile-display-name').textContent = nom;
    document.getElementById('profile-uid-text').textContent     = `Personal Workspace ID: ${uid}`;
    document.getElementById('input-profile-name').value         = nom;

    const total     = toutesMesSessions.length;
    const enCours   = toutesMesSessions.filter(s => s.statut === 'en_cours').length;
    const terminees = toutesMesSessions.filter(s => s.statut === 'resolu').length;

    document.getElementById('stat-total-count').textContent     = total;
    document.getElementById('stat-progress-count').textContent  = enCours;
    document.getElementById('stat-completed-count').textContent = terminees;
}

function sauvegarderProfilNom() {
    const val = document.getElementById('input-profile-name').value.trim();
    if (val) {
        localStorage.setItem('repairlens_username', val);
        remplirInfosProfil();
        afficherToast(getLangue() === 'fr' ? 'Profil enregistré avec succès !' : 'Profile saved successfully!', '');
    }
}

window.rafraichirVueActuelle = function() {
    filtrerEtAfficherHistorique();
    remplirInfosProfil();
};

document.addEventListener('DOMContentLoaded', initialiserPageHistorique);
