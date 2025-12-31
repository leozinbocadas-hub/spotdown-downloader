const playlistUrl = document.getElementById('playlistUrl');
const fetchBtn = document.getElementById('fetchBtn');
const tracksSection = document.getElementById('tracksSection');
const tracksList = document.getElementById('tracksList');
const emptyState = document.getElementById('emptyState');
const changeFolderBtn = document.getElementById('changeFolderBtn');
const selectedPathText = document.getElementById('selectedPath');
const downloadAllBtn = document.getElementById('downloadAllBtn');
const settingsBtn = document.getElementById('settingsBtn');
const settingsModal = document.getElementById('settingsModal');
const closeModalBtn = document.querySelector('.close-modal-btn');

let currentTracks = [];
let currentPlaylistName = 'Minha Playlist';
let downloadPath = '';

// --- AUTH LOGIC ---
const authContainer = document.getElementById('authContainer');
const mainApp = document.getElementById('mainApp');
const licenseKeyInput = document.getElementById('licenseKeyInput');
const activateBtn = document.getElementById('activateBtn');
const authStatus = document.getElementById('authStatus');

async function checkLicenseStatus() {
    const result = await window.electronAPI.checkLicense();
    if (result.success) {
        authContainer.style.display = 'none';
        mainApp.style.display = 'flex';

        // Atualizar informações da licença na UI
        const planMap = {
            'month': 'Mensal',
            'year': 'Anual',
            'lifetime': 'Vitalício'
        };

        const planName = planMap[result.plan] || 'Ativa';
        document.getElementById('licensePlanDisplay').textContent = `Plano: ${planName}`;

        // Formatar datas
        const options = { day: '2-digit', month: '2-digit', year: 'numeric' };
        if (result.activatedAt) {
            const actDate = new Date(result.activatedAt).toLocaleDateString('pt-BR', options);
            document.getElementById('licenseActivatedAt').textContent = actDate;
        }

        const expiryContainer = document.getElementById('expiryContainer');
        if (result.plan === 'lifetime') {
            expiryContainer.style.display = 'none';
        } else if (result.expiresAt) {
            expiryContainer.style.display = 'block';
            const expDate = new Date(result.expiresAt).toLocaleDateString('pt-BR', options);
            document.getElementById('licenseExpiresAt').textContent = expDate;
        }

        window.electronAPI.logToTerminal(`[AUTH] Licença ativa: ${planName}`);
    } else {
        authContainer.style.display = 'flex';
        mainApp.style.display = 'none';
        if (result.error) authStatus.innerText = result.error;
    }
}

activateBtn.addEventListener('click', async () => {
    const key = licenseKeyInput.value.trim();
    if (!key) return;

    activateBtn.disabled = true;
    activateBtn.innerText = 'Ativando...';
    authStatus.innerText = '';

    const result = await window.electronAPI.activateLicense(key);

    if (result.success) {
        authStatus.style.color = '#1DB954';
        authStatus.innerText = 'Sucesso! Abrindo...';
        setTimeout(() => checkLicenseStatus(), 1500);
    } else {
        activateBtn.disabled = false;
        activateBtn.innerText = 'Ativar Agora';
        authStatus.style.color = '#ff4444';
        authStatus.innerText = result.error || 'Erro ao ativar';
    }
});

// Inicialização
checkLicenseStatus();

// Inicializar path padrão
window.electronAPI.getDefaultPath().then(path => {
    downloadPath = path;
    selectedPathText.textContent = `Salvar em: ${path}`;
});

// --- ACTIONS ---
changeFolderBtn.addEventListener('click', async () => {
    const path = await window.electronAPI.selectFolder();
    if (path) {
        downloadPath = path;
        selectedPathText.textContent = `Salvar em: ${path}`;
    }
});

fetchBtn.addEventListener('click', async () => {
    const url = playlistUrl.value.trim();
    if (!url) return;

    fetchBtn.disabled = true;
    fetchBtn.textContent = 'Buscando...';

    const result = await window.electronAPI.getSpotifyTracks(url);

    fetchBtn.disabled = false;
    fetchBtn.textContent = 'Buscar';

    if (result.success) {
        currentTracks = result.tracks;
        currentPlaylistName = result.playlistName || 'Playlist';
        renderTracks();
        emptyState.style.display = 'none';
        tracksSection.style.display = 'block';
    } else {
        alert('Erro ao buscar playlist: ' + result.error);
    }
});

function renderTracks() {
    tracksList.innerHTML = currentTracks.map(track => `
        <div class="track-item" id="track-${track.id}">
            <img src="${track.cover}" class="track-img" alt="Capa">
            <div class="track-info">
                <div class="track-title">${track.title}</div>
                <div class="track-artist">${track.artist}</div>
            </div>
            <div class="track-status" id="status-${track.id}">Pendente</div>
            <div class="progress-bar">
                <div class="progress-fill" id="progress-${track.id}"></div>
            </div>
        </div>
    `).join('');
}

downloadAllBtn.addEventListener('click', async () => {
    window.electronAPI.logToTerminal(`[UI] Iniciando download paralelo. Fila: ${currentTracks.length}`);

    downloadAllBtn.disabled = true;
    downloadAllBtn.textContent = 'Baixando...';

    const CONCURRENCY = 5;
    const queue = currentTracks.map((t, i) => ({ track: t, index: i }));
    let activeCount = 0;

    const processTrack = async (track, index) => {
        try {
            const statusEl = document.getElementById(`status-${track.id}`);
            const progressEl = document.getElementById(`progress-${track.id}`);
            if (!statusEl) return;

            statusEl.textContent = 'Baixando...';
            statusEl.classList.add('downloading');
            if (progressEl) progressEl.style.width = '30%';

            window.electronAPI.logToTerminal(`[UI] Baixando [${index + 1}/${currentTracks.length}]: ${track.title}`);
            const result = await window.electronAPI.downloadTrack(track, downloadPath, currentPlaylistName, index);

            if (result.success) {
                statusEl.textContent = 'Concluído';
                statusEl.classList.remove('downloading');
                statusEl.style.color = '#1DB954';
                if (progressEl) progressEl.style.width = '100%';
            } else {
                statusEl.textContent = 'Falhou';
                statusEl.classList.remove('downloading');
                statusEl.style.color = '#ff4444';
                if (progressEl) progressEl.style.width = '0%';
                window.electronAPI.logToTerminal(`[UI] Falha em ${track.title}: ${result.error}`);
            }
        } catch (err) {
            window.electronAPI.logToTerminal(`[UI] Erro crítico em ${track.title}: ${err.message}`);
        }
    };

    const startNext = async () => {
        if (queue.length === 0) return;

        activeCount++;
        const item = queue.shift();

        await processTrack(item.track, item.index);

        activeCount--;
        startNext();
    };

    // Inicia o pool
    for (let i = 0; i < Math.min(CONCURRENCY, queue.length); i++) {
        startNext();
    }

    const checkFinished = setInterval(() => {
        if (activeCount === 0 && queue.length === 0) {
            clearInterval(checkFinished);
            downloadAllBtn.disabled = false;
            downloadAllBtn.textContent = 'Baixar Tudo';
            window.electronAPI.logToTerminal(`[UI] Playlist finalizada.`);
        }
    }, 1000);
});

// Settings Modal
settingsBtn.addEventListener('click', () => settingsModal.style.display = 'flex');
closeModalBtn.addEventListener('click', () => settingsModal.style.display = 'none');
window.onclick = (event) => {
    if (event.target == settingsModal) settingsModal.style.display = 'none';
};
