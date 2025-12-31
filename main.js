const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const axios = require('axios');
const NodeID3 = require('node-id3');
const ffmpegPathRaw = require('ffmpeg-static');
const ffmpegPath = ffmpegPathRaw.replace('app.asar', 'app.asar.unpacked');
const ytdlpPath = path.join(__dirname, 'node_modules', 'yt-dlp-exec', 'bin', 'yt-dlp.exe').replace('app.asar', 'app.asar.unpacked');

require('dotenv').config();

const { createClient } = require('@supabase/supabase-js');
const { machineIdSync } = require('node-machine-id');

const SUPABASE_URL = "https://losoyzweqnbxcrqihfqq.supabase.co";
const SUPABASE_KEY = "sb_publishable_QV_dRA7GPus2becm6-hbcQ_PNggZGBy";
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const os = require('os');
const hwid = machineIdSync();

let mainWindow;
const defaultDownloadPath = path.join(os.homedir(), 'Downloads', 'SpotDown');

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1000,
        height: 700,
        backgroundColor: '#000000',
        titleBarStyle: 'hidden',
        titleBarOverlay: {
            color: '#00000000',
            symbolColor: '#ffffff',
            height: 40
        },
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true
        },
        icon: path.join(__dirname, 'assets', 'icons', 'icon.ico')
    });

    mainWindow.loadFile('index.html');
    // mainWindow.webContents.openDevTools();
}

// --- CONFIGURAÇÃO DE ATUALIZAÇÕES AUTOMÁTICAS ---
autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = true;

autoUpdater.on('update-available', () => {
    if (mainWindow) {
        mainWindow.webContents.send('log', 'Nova atualização disponível! Baixando...');
    }
});

autoUpdater.on('update-downloaded', () => {
    if (mainWindow) {
        mainWindow.webContents.send('log', 'Atualização baixada. Reinicie para aplicar.');
    }
});

app.whenReady().then(() => {
    createWindow();
    autoUpdater.checkForUpdatesAndNotify();
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// --- SPOTIFY AUTH & UTILS ---
async function getSystemSpotifyAccessToken() {
    const authHeader = Buffer.from(`${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`).toString('base64');
    const response = await axios.post('https://accounts.spotify.com/api/token',
        'grant_type=client_credentials',
        {
            headers: {
                'Authorization': `Basic ${authHeader}`,
                'Content-Type': 'application/x-www-form-urlencoded'
            }
        }
    );
    return response.data.access_token;
}

async function getSpotifyPlaylistMetadata(playlistId, accessToken) {
    const response = await axios.get(`https://api.spotify.com/v1/playlists/${playlistId}?fields=name`, {
        headers: { 'Authorization': `Bearer ${accessToken}` }
    });
    return response.data.name;
}

async function fetchSpotifyPlaylist(playlistId, accessToken) {
    let tracks = [];
    let nextUrl = `https://api.spotify.com/v1/playlists/${playlistId}/tracks?limit=100&fields=next,items(track(id,name,duration_ms,artists(name),album(images)))`;

    while (nextUrl) {
        const response = await axios.get(nextUrl, {
            headers: { 'Authorization': `Bearer ${accessToken}` }
        });

        const items = response.data.items
            .filter(item => item && item.track) // Garante que a track existe
            .map(item => ({
                id: item.track.id,
                title: item.track.name,
                artist: item.track.artists.map(a => a.name).join(', '),
                cover: item.track.album.images[0]?.url || null,
                duration_ms: item.track.duration_ms,
            }));

        tracks = [...tracks, ...items];
        nextUrl = response.data.next;
    }
    return tracks;
}

// --- UTILS ---
const cleanForSearch = (str) => {
    return str.normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^\w\s-]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
};

// --- IPC HANDLERS ---
ipcMain.on('log-to-terminal', (event, message) => {
    console.log(`[APP-UI] ${message}`);
});

ipcMain.handle('get-default-path', () => {
    return defaultDownloadPath;
});

// --- LÓGICA DE LICENÇAS ---
ipcMain.handle('check-license', async () => {
    try {
        const configPath = path.join(app.getPath('userData'), 'license.json');
        if (!fs.existsSync(configPath)) return { success: false };

        const { key } = JSON.parse(fs.readFileSync(configPath, 'utf8'));

        const { data, error } = await supabase
            .from('licenses')
            .select('*')
            .eq('license_key', key)
            .eq('hwid', hwid)
            .single();

        if (error || !data) return { success: false };

        // Verificar expiração
        if (data.expires_at && new Date(data.expires_at) < new Date()) {
            return { success: false, error: 'Licença expirada' };
        }

        return {
            success: true,
            plan: data.plan_type,
            activatedAt: data.activated_at,
            expiresAt: data.expires_at
        };
    } catch (e) {
        return { success: false };
    }
});

ipcMain.handle('activate-license', async (event, key) => {
    try {
        // 1. Verificar se a chave existe e não foi usada (ou se é do mesmo HWID)
        const { data: license, error } = await supabase
            .from('licenses')
            .select('*')
            .eq('license_key', key)
            .single();

        if (error || !license) return { success: false, error: 'Chave inválida' };

        if (license.is_activated && license.hwid !== hwid) {
            return { success: false, error: 'Chave já em uso em outro PC' };
        }

        // 2. Calcular expiração
        let expiresAt = null;
        const now = new Date();
        if (license.plan_type === 'month') {
            expiresAt = new Date(now.setMonth(now.getMonth() + 1)).toISOString();
        } else if (license.plan_type === 'year') {
            expiresAt = new Date(now.setFullYear(now.getFullYear() + 1)).toISOString();
        }

        // 3. Ativar no banco
        const { error: updateError } = await supabase
            .from('licenses')
            .update({
                is_activated: true,
                hwid: hwid,
                activated_at: new Date().toISOString(),
                expires_at: expiresAt
            })
            .eq('id', license.id);

        if (updateError) throw updateError;

        // 4. Salvar localmente
        const configPath = path.join(app.getPath('userData'), 'license.json');
        fs.writeFileSync(configPath, JSON.stringify({ key }));

        return { success: true, plan: license.plan_type };
    } catch (e) {
        return { success: false, error: e.message };
    }
});

ipcMain.handle('select-folder', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
        properties: ['openDirectory']
    });
    return result.filePaths[0];
});

ipcMain.handle('get-spotify-tracks', async (event, playlistUrl) => {
    try {
        console.log(`[DESKTOP] Buscando playlist: ${playlistUrl}`);

        // Parsing mais robusto do ID da playlist
        let playlistId = playlistUrl;
        if (playlistUrl.includes('spotify.com/playlist/')) {
            playlistId = playlistUrl.split('playlist/')[1].split('?')[0].split('/')[0];
        }

        console.log(`[DESKTOP] ID extraído: ${playlistId}`);

        const token = await getSystemSpotifyAccessToken();
        console.log(`[DESKTOP] Token obtido com sucesso`);

        const tracks = await fetchSpotifyPlaylist(playlistId, token);
        const playlistName = await getSpotifyPlaylistMetadata(playlistId, token);
        console.log(`[DESKTOP] Total de músicas encontradas: ${tracks.length}`);

        return { success: true, tracks, playlistName };
    } catch (error) {
        console.error(`[DESKTOP ERROR]`, error.response?.data || error.message);
        const detail = error.response?.data?.error?.message || error.message;
        return { success: false, error: detail };
    }
});

ipcMain.handle('download-track', async (event, track, baseDownloadPath, playlistName, index) => {
    const { id, title, artist, cover, duration_ms } = track;

    // Criar pasta exclusiva da playlist
    const cleanPlaylistName = cleanForSearch(playlistName);
    const finalDownloadPath = path.join(baseDownloadPath, cleanPlaylistName);

    // GARANTIR QUE A PASTA EXISTE
    try {
        if (!fs.existsSync(finalDownloadPath)) {
            fs.mkdirSync(finalDownloadPath, { recursive: true });
        }
    } catch (e) {
        console.error(`[DESKTOP] Erro ao criar pasta: ${e.message}`);
        return { success: false, error: `Não foi possível criar a pasta: ${e.message}` };
    }

    const sTitle = cleanForSearch(title);
    const sArtistList = cleanForSearch(artist.split(',')[0]);

    // Adicionar numeração ao nome do arquivo
    const fileNumber = (index + 1).toString().padStart(2, '0');
    const safeFilename = `${fileNumber} - ${sTitle} - ${sArtistList}.mp3`;
    const filePath = path.join(finalDownloadPath, safeFilename);
    const searchQuery = `${sTitle} ${sArtistList} official audio`;

    // Tentativa YouTube
    try {
        console.log(`[DESKTOP] Baixando: ${title} - ${artist}`);
        console.log(`[DESKTOP] Arquivo: ${safeFilename}`);

        await new Promise((resolve, reject) => {
            const args = [
                '--force-ipv4',
                '-x',
                '--audio-format', 'mp3',
                '--audio-quality', '0',
                '--ffmpeg-location', ffmpegPath,
                '--no-playlist',
                '--max-downloads', '1',
                '--socket-timeout', '30',
                '--retries', '5',
                '-o', filePath,
                `ytsearch1:${searchQuery}`
            ];

            const ls = spawn(ytdlpPath, args);

            ls.stdout.on('data', (data) => {
                const line = data.toString();
                if (line.includes('[download]') || line.includes('[ExtractAudio]')) {
                    console.log(`[yt-dlp] ${line.trim()}`);
                }
            });

            ls.on('error', (err) => {
                console.error(`[DESKTOP] Falha ao iniciar yt-dlp: ${err.message}`);
                reject(err);
            });

            ls.on('close', (code) => {
                // Código 0 = Sucesso
                // Código 101 = Sucesso ao atingir --max-downloads 1
                if (code === 0 || code === 101) {
                    resolve();
                } else {
                    console.error(`[DESKTOP] Erro Code ${code} em: ${title}`);
                    reject(new Error(`yt-dlp exit code ${code}`));
                }
            });
        });

        // VERIFICAÇÃO REAL: O arquivo foi criado?
        if (!fs.existsSync(filePath)) {
            throw new Error('Arquivo MP3 não foi encontrado após o processo do yt-dlp.');
        }

        // Tagging
        const tags = {
            title: title,
            artist: artist,
            comment: { language: "por", text: "SpotDown Desktop" }
        };

        if (cover) {
            try {
                const img = await axios.get(cover, { responseType: 'arraybuffer', timeout: 5000 });
                tags.image = {
                    mime: "image/jpeg",
                    type: { id: 3, name: 'front cover' },
                    description: 'Album cover',
                    imageBuffer: Buffer.from(img.data)
                };
            } catch (e) {
                console.warn(`[DESKTOP] Não foi possível baixar a capa para: ${title}`);
            }
        }

        NodeID3.write(tags, filePath);
        console.log(`[DESKTOP] Finalizado com sucesso: ${filePath}`);
        return { success: true };
    } catch (err) {
        console.error(`[DESKTOP] Erro no download de ${title}:`, err.message);
        return { success: false, error: err.message };
    }
});
