require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const axios = require('axios');
const { exec } = require('child_process');
const fs = require('fs/promises');
const path = require('path');
const archiver = require('archiver');
const NodeID3 = require('node-id3');
const pLimit = require('p-limit').default;
const ffmpegPath = require('ffmpeg-static');
const { S3Client, PutObjectCommand, DeleteObjectCommand, ListObjectsV2Command, DeleteObjectsCommand } = require('@aws-sdk/client-s3');
const { Upload } = require('@aws-sdk/lib-storage');

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

const r2 = new S3Client({
    region: 'auto',
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
});

const CONCURRENT_DOWNLOADS_LIMIT = 5; // Limite global de tracks sendo baixadas simultaneamente
const downloadLimiter = pLimit(CONCURRENT_DOWNLOADS_LIMIT);

const CONCURRENT_JOBS_LIMIT = 5; // Limite de playlists sendo processadas simultaneamente
const jobLimiter = pLimit(CONCURRENT_JOBS_LIMIT);
const activeJobIds = new Set();

// Garantir que a pasta tmp existe
(async () => {
    const tmpPath = path.join(__dirname, 'tmp');
    await fs.mkdir(tmpPath, { recursive: true });
})();

// --- UTILS ---
async function downloadAndTagTrack(trackData, downloadTaskId) {
    const { spotify_track_id, title, artist, album_cover_url } = trackData;
    const taskDir = path.join(__dirname, 'tmp', downloadTaskId);
    await fs.mkdir(taskDir, { recursive: true });

    // Nome do arquivo limpo
    const safeTitle = title.replace(/[^\w\s-]/gi, '').trim();
    const downloadedFilePath = path.join(taskDir, `${spotify_track_id}.mp3`);

    let downloadUrl = null;
    let errorMessage = null;

    try {
        // 1. Limpeza agressiva do título
        const cleanTitle = title.split(' (')[0].split(' - ')[0].replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();

        // 2. Artistas simplificados
        const firstTwoArtists = artist.split(',').slice(0, 2).map(a => a.trim()).join(' ');
        const cleanArtists = firstTwoArtists.replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();

        const specificQuery = `${cleanTitle} ${cleanArtists}`;
        const broadQuery = cleanTitle;
        const expectedSeconds = Math.floor(trackData.duration_ms / 1000);

        // 3. Janela dinâmica
        const margin = expectedSeconds > 300 ? 50 : 30;
        const minDur = Math.max(0, expectedSeconds - margin);
        const maxDur = expectedSeconds + margin;
        const durationFilter = `--match-filter "duration > ${minDur} & duration < ${maxDur}"`;

        console.log(`[WORKER] Iniciando busca: ${title} - ${artist} (Duração esperada: ${expectedSeconds}s)`);

        let cookiesFlag = '';
        const rootCookiesPath = path.join(__dirname, 'cookies.txt');
        try {
            await fs.access(rootCookiesPath);
            cookiesFlag = `--cookies "${rootCookiesPath}"`;
        } catch (e) { }

        // --- TENTATIVA 1: SOUNDCLOUD (SPECIFIC) ---
        console.log(`[WORKER] [SOUNDCLOUD] Buscando específico: ${specificQuery}`);
        const scCommand = `yt-dlp --force-ipv4 -x --audio-format mp3 --ffmpeg-location "${ffmpegPath}" --no-check-certificates --geo-bypass --no-playlist ${durationFilter} --extract-audio --audio-quality 0 -o "${downloadedFilePath}" "scsearch10:${specificQuery}"`;
        try {
            await new Promise((resolve, reject) => {
                let timeout;
                const childProcess = exec(scCommand, (error) => {
                    if (timeout) clearTimeout(timeout);
                    if (error) reject(error);
                    else resolve();
                });
                timeout = setTimeout(() => { childProcess.kill(); reject(new Error('Timeout SC')); }, 60000);
            });
        } catch (e) {
            // broad
            if (!await fs.stat(downloadedFilePath).catch(() => null)) {
                console.log(`[WORKER] [SOUNDCLOUD] Buscando amplo: ${broadQuery}`);
                const scBroad = `yt-dlp --force-ipv4 -x --audio-format mp3 --ffmpeg-location "${ffmpegPath}" --no-check-certificates --geo-bypass --no-playlist ${durationFilter} --extract-audio --audio-quality 0 -o "${downloadedFilePath}" "scsearch10:${broadQuery}"`;
                try {
                    await new Promise((resolve, reject) => {
                        let timeout;
                        const childProcess = exec(scBroad, (err) => {
                            if (timeout) clearTimeout(timeout);
                            if (err) reject(err);
                            else resolve();
                        });
                        timeout = setTimeout(() => { childProcess.kill(); reject(new Error('Timeout SC Broad')); }, 60000);
                    });
                } catch (e2) { }
            }
        }

        let hasFile = await fs.stat(downloadedFilePath).catch(() => null);

        // --- TENTATIVA 2: VIMEO ---
        if (!hasFile) {
            console.log(`[WORKER] [VIMEO] Buscando: ${specificQuery}`);
            const vimeoCommand = `yt-dlp --force-ipv4 -x --audio-format mp3 --ffmpeg-location "${ffmpegPath}" --no-check-certificates --geo-bypass --no-playlist ${durationFilter} --extract-audio --audio-quality 0 -o "${downloadedFilePath}" "vsearch5:${specificQuery}"`;
            try {
                await new Promise((resolve, reject) => {
                    let timeout;
                    const childProcess = exec(vimeoCommand, (error) => {
                        if (timeout) clearTimeout(timeout);
                        if (error) reject(error);
                        else resolve();
                    });
                    timeout = setTimeout(() => { childProcess.kill(); reject(new Error('Timeout Vimeo')); }, 60000);
                });
                hasFile = await fs.stat(downloadedFilePath).catch(() => null);
            } catch (e) { }
        }

        // --- TENTATIVA 3: YOUTUBE ---
        if (!hasFile) {
            console.warn(`[WORKER] SoundCloud/Vimeo falharam. Usando YouTube com clientes iOS/Web...`);
            const ytDlpCommand = `yt-dlp --force-ipv4 -x --audio-format mp3 ${cookiesFlag} --ffmpeg-location "${ffmpegPath}" --no-check-certificates --geo-bypass --no-playlist ${durationFilter} --match-filter "!is_live & !is_upcoming" --extractor-args "youtube:player_client=ios,web_embedded" --add-header "User-Agent:Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1" --extract-audio --audio-quality 0 -o "${downloadedFilePath}" "ytsearch5:${specificQuery}"`;
            await new Promise((resolve, reject) => {
                let timeout;
                const childProcess = exec(ytDlpCommand, (error) => {
                    if (timeout) clearTimeout(timeout);
                    if (error) reject(error);
                    else resolve();
                });
                timeout = setTimeout(() => { childProcess.kill(); reject(new Error('Timeout YouTube')); }, 90000);
            });
            hasFile = await fs.stat(downloadedFilePath).catch(() => null);
        }

        if (!hasFile) throw new Error('Música não encontrada em nenhuma fonte (SC/Vimeo/YT).');

        // Tagging
        const tags = {
            title: title,
            artist: artist,
            comment: { language: "por", text: "Baixado via SpotDown" }
        };

        if (album_cover_url) {
            try {
                const imageResponse = await axios.get(album_cover_url, { responseType: 'arraybuffer', timeout: 5000 });
                tags.image = {
                    mime: "image/jpeg",
                    type: { id: 3, name: 'front cover' },
                    description: 'Album cover',
                    imageBuffer: Buffer.from(imageResponse.data)
                };
            } catch (e) { }
        }

        NodeID3.write(tags, downloadedFilePath);

        // Upload
        const trackKey = `tracks/${downloadTaskId}/${spotify_track_id}.mp3`;
        const fileStream = require('fs').createReadStream(downloadedFilePath);

        const upload = new Upload({
            client: r2,
            params: {
                Bucket: process.env.R2_BUCKET_NAME,
                Key: trackKey,
                Body: fileStream,
                ContentType: 'audio/mpeg',
            },
        });

        await upload.done();
        downloadUrl = `${process.env.R2_PUBLIC_URL}/${trackKey}`;
        console.log(`[WORKER] Sucesso (R2): ${title}`);

    } catch (error) {
        console.error(`[WORKER ERROR] ${title}:`, error.message);
        errorMessage = error.message;
    }

    return { downloadUrl, errorMessage };
}

async function deleteR2Folder(prefix) {
    try {
        const listParams = {
            Bucket: process.env.R2_BUCKET_NAME,
            Prefix: prefix
        };
        const listedObjects = await r2.send(new ListObjectsV2Command(listParams));

        if (!listedObjects.Contents || listedObjects.Contents.length === 0) return;

        const deleteParams = {
            Bucket: process.env.R2_BUCKET_NAME,
            Delete: { Objects: [] }
        };

        listedObjects.Contents.forEach(({ Key }) => {
            deleteParams.Delete.Objects.push({ Key });
        });

        await r2.send(new DeleteObjectsCommand(deleteParams));

        if (listedObjects.IsTruncated) {
            await deleteR2Folder(prefix);
        }
        console.log(`[WORKER] Pasta R2 removida: ${prefix}`);
    } catch (e) {
        console.error(`[WORKER] Erro ao deletar prefixo ${prefix} no R2:`, e.message);
    }
}

async function cleanupExpiredTasks() {
    console.log('[WORKER] Iniciando faxina de arquivos expirados no R2...');
    try {
        // 15 minutos de expiração (garante tempo para o usuário baixar)
        const expirationTime = new Date(Date.now() - 15 * 60 * 1000).toISOString();

        // Buscar tarefas que já deveriam ter sido limpas mas não foram (por queda do worker, etc)
        const { data: tasksToCleanup } = await supabase
            .from('download_tasks')
            .select('id, status')
            .in('status', ['completed', 'failed'])
            .lt('updated_at', expirationTime);

        if (tasksToCleanup && tasksToCleanup.length > 0) {
            console.log(`[WORKER] Encontradas ${tasksToCleanup.length} tarefas pendentes de limpeza.`);
            for (const task of tasksToCleanup) {
                console.log(`[WORKER] [CLEANUP] Limpando arquivos da tarefa: ${task.id}`);

                // Deletar ZIP
                await r2.send(new DeleteObjectCommand({
                    Bucket: process.env.R2_BUCKET_NAME,
                    Key: `${task.id}.zip`
                })).catch(() => { });

                // Deletar folder de tracks INTEIRO
                await deleteR2Folder(`tracks/${task.id}/`);

                // Marcar como expirado no banco
                await supabase.from('download_tasks')
                    .update({ status: 'expired', updated_at: new Date().toISOString() })
                    .eq('id', task.id);
            }
        }
    } catch (e) {
        console.error('[WORKER] Erro durante limpeza global:', e.message);
    }
}

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

async function fetchSpotifyPlaylist(playlistId, accessToken) {
    let tracks = [];
    let nextUrl = `https://api.spotify.com/v1/playlists/${playlistId}/tracks?limit=100&fields=next,items(track(id,name,duration_ms,artists(name),album(images)))`;

    while (nextUrl) {
        const response = await axios.get(nextUrl, {
            headers: { 'Authorization': `Bearer ${accessToken}` }
        });

        const items = response.data.items.map(item => ({
            spotify_track_id: item.track.id,
            title: item.track.name,
            artist: item.track.artists.map(a => a.name).join(', '),
            album_cover_url: item.track.album.images[0]?.url || null,
            duration_ms: item.track.duration_ms,
        }));

        tracks = [...tracks, ...items];
        nextUrl = response.data.next;
    }

    return tracks;
}

async function processDownloadTask(job) {
    const { downloadTaskId, spotifyPlaylistUrl } = job.payload;
    const playlistId = spotifyPlaylistUrl.split('/').pop().split('?')[0];

    // Marcar job como 'processing'
    await supabase.from('jobs').update({ status: 'processing', started_at: new Date().toISOString() }).eq('id', job.id);

    const updateTask = async (updates) => {
        const { data: updatedTask } = await supabase
            .from('download_tasks')
            .update({ ...updates, updated_at: new Date().toISOString() })
            .eq('id', downloadTaskId)
            .select()
            .single();

        // Enviar via Realtime Broadcast
        await supabase.channel(`task_${downloadTaskId}`).send({
            type: 'broadcast',
            event: 'task_update',
            payload: updates
        });
        return updatedTask;
    };

    let tracksDownloaded = 0;
    try {
        console.log(`[WORKER] Processando Tarefa: ${downloadTaskId}`);
        await updateTask({ status: 'fetching_metadata' });

        const accessToken = await getSystemSpotifyAccessToken();
        const playlistTracks = await fetchSpotifyPlaylist(playlistId, accessToken);

        await updateTask({
            total_tracks: playlistTracks.length,
            status: 'downloading'
        });

        const downloadPromises = playlistTracks.map((track, index) =>
            downloadLimiter(async () => {
                // Marcar como baixando no banco e broadcast
                await supabase.from('playlist_tracks')
                    .update({ status: 'downloading' })
                    .eq('task_id', downloadTaskId)
                    .eq('spotify_track_id', track.spotify_track_id);

                await supabase.channel(`task_${downloadTaskId}`).send({
                    type: 'broadcast',
                    event: 'track_update',
                    payload: {
                        trackId: track.spotify_track_id,
                        status: 'downloading'
                    }
                });

                const { downloadUrl, errorMessage } = await downloadAndTagTrack(track, downloadTaskId);

                await supabase.from('playlist_tracks')
                    .update({
                        status: downloadUrl ? 'completed' : 'failed',
                        download_url: downloadUrl,
                        error_message: errorMessage
                    })
                    .eq('task_id', downloadTaskId)
                    .eq('spotify_track_id', track.spotify_track_id);

                if (downloadUrl) tracksDownloaded++;

                // Notificar frontend sobre a track específica (finalizado)
                await supabase.channel(`task_${downloadTaskId}`).send({
                    type: 'broadcast',
                    event: 'track_update',
                    payload: {
                        trackId: track.spotify_track_id,
                        status: downloadUrl ? 'completed' : 'failed',
                        downloadUrl
                    }
                });

                await updateTask({ tracks_downloaded: tracksDownloaded });
            })
        );

        await Promise.all(downloadPromises);

        // --- ZIPPING ---
        if (tracksDownloaded > 0) {
            await updateTask({ status: 'zipping' });
            console.log(`[WORKER] Gerando ZIP para ${downloadTaskId}`);

            const tempZipPath = path.join(__dirname, 'tmp', `${downloadTaskId}.zip`);
            const output = require('fs').createWriteStream(tempZipPath);
            const archive = archiver('zip', { zlib: { level: 9 } });

            archive.pipe(output);

            const { data: successfulTracks } = await supabase
                .from('playlist_tracks')
                .select('*')
                .eq('task_id', downloadTaskId)
                .eq('status', 'completed');

            for (const t of successfulTracks) {
                try {
                    const localPath = path.join(__dirname, 'tmp', downloadTaskId, `${t.spotify_track_id}.mp3`);
                    const fileName = `${t.track_number}-${t.title.replace(/[^\w\s-]/gi, '')}.mp3`;
                    archive.file(localPath, { name: fileName });
                } catch (e) {
                    console.error(`[WORKER] Erro ao incluir track no ZIP (local): ${t.title}`);
                }
            }

            await archive.finalize();
            await new Promise((resolve, reject) => {
                output.on('close', resolve);
                output.on('error', reject);
            });

            const zipName = `${downloadTaskId}.zip`;
            const fileStream = require('fs').createReadStream(tempZipPath);

            console.log(`[WORKER] Iniciando Upload para R2: ${zipName}`);

            const upload = new Upload({
                client: r2,
                params: {
                    Bucket: process.env.R2_BUCKET_NAME,
                    Key: zipName,
                    Body: fileStream,
                    ContentType: 'application/zip',
                },
            });

            await upload.done();

            const publicUrl = `${process.env.R2_PUBLIC_URL}/${zipName}`;

            await updateTask({
                status: 'completed',
                zip_file_url: publicUrl,
                end_time: new Date().toISOString()
            });

            console.log(`[WORKER] ZIP Finalizado e disponível no R2: ${publicUrl}`);

            // --- LIMPEZA DE ESPAÇO ---
            // Deletar ZIP do R2 após 10 minutos (tempo maior para garantir o download)
            setTimeout(async () => {
                try {
                    // Deletar o ZIP
                    await r2.send(new DeleteObjectCommand({
                        Bucket: process.env.R2_BUCKET_NAME,
                        Key: zipName
                    })).catch(() => { });

                    // Deletar pasta de tracks inteira (mais robusto que deletar um por um)
                    await deleteR2Folder(`tracks/${downloadTaskId}/`);

                    await updateTask({ zip_file_url: null, status: 'expired' });
                    console.log(`[WORKER] ZIP e tracks removidos do R2 após expirar.`);
                } catch (e) {
                    console.error('[WORKER] Erro ao limpar R2:', e.message);
                }
            }, 600000); // 10 minutos
        } else {
            throw new Error('Nenhuma música foi baixada com sucesso.');
        }

    } catch (error) {
        console.error(`[WORKER CRITICAL ERROR]`, error);

        // Se já baixamos as músicas, não vamos marcar como total falha e sim como parcial
        // ou avisar que o ZIP falhou mas as tracks estão lá.
        if (tracksDownloaded > 0) {
            await updateTask({
                status: 'completed',
                error_message: `Aviso: O arquivo ZIP não pôde ser gerado (${error.message}), mas as músicas individuais estão disponíveis abaixo.`
            });
        } else {
            await updateTask({ status: 'failed', error_message: error.message });
        }
    } finally {
        // Cleanup
        await supabase.from('jobs').delete().eq('id', job.id);
        const taskDir = path.join(__dirname, 'tmp', downloadTaskId);
        await fs.rm(taskDir, { recursive: true, force: true }).catch(() => { });
        await fs.unlink(path.join(__dirname, 'tmp', `${downloadTaskId}.zip`)).catch(() => { });
    }
}

async function startWorker() {
    console.log('--- SpotDown Worker Ativo (GUEST MODE) ---');
    console.log(`[SYS] FFmpeg path: ${ffmpegPath}`);

    // Polling inicial para jobs pendentes
    const pollJobs = async () => {
        // 1. Buscar jobs pendentes
        const { data: pendingJobs } = await supabase
            .from('jobs')
            .select('*')
            .eq('status', 'pending')
            .order('created_at', { ascending: true });

        // 2. Buscar jobs que estão 'processing' há muito tempo (stuck jobs)
        // Se um job está processando por mais de 30 minutos, provavelmente o worker caiu
        const thirtyMinsAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();
        const { data: stuckJobs } = await supabase
            .from('jobs')
            .select('*')
            .eq('status', 'processing')
            .lt('started_at', thirtyMinsAgo)
            .order('created_at', { ascending: true });

        const allJobs = [...(pendingJobs || []), ...(stuckJobs || [])];

        if (allJobs.length > 0) {
            for (const job of allJobs) {
                if (activeJobIds.has(job.id)) continue;

                activeJobIds.add(job.id);
                console.log(`[WORKER] Adicionando Job à fila de execução: ${job.id}`);

                jobLimiter(async () => {
                    try {
                        await processDownloadTask(job);
                    } catch (err) {
                        console.error(`[WORKER] Erro ao processar job ${job.id}:`, err);
                    } finally {
                        activeJobIds.delete(job.id);
                    }
                });
            }
        }
        setTimeout(pollJobs, 5000);
    };

    pollJobs();

    // Rodar limpeza inicial e agendar a cada 10 minutos
    cleanupExpiredTasks();
    setInterval(cleanupExpiredTasks, 10 * 60 * 1000);

    // Realtime listener
    supabase.channel('jobs_queue')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'jobs' }, (payload) => {
            console.log('[WORKER] Novo Job detectado via Realtime');
        })
        .subscribe();
}

startWorker();
