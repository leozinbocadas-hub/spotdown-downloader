import { createClient } from '@/utils/supabase/server';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { fetchSpotifyPlaylist } from '@/lib/spotify';

const schema = z.object({
    spotifyPlaylistUrl: z.string().url(),
});

export async function POST(request: Request) {
    try {
        const body = await request.json();
        const { spotifyPlaylistUrl } = schema.parse(body);
        const playlistId = spotifyPlaylistUrl.split('/').pop()?.split('?')[0];

        if (!playlistId) throw new Error('URL de playlist inválida');

        // Buscar metadados via Client Credentials (não precisa de login do usuário)
        const { name: playlistName, tracks } = await fetchSpotifyPlaylist(playlistId);

        const supabase = await createClient();

        // 1. Criar tarefa (anonimizada se não houver usuário)
        const { data: { user } } = await supabase.auth.getUser();

        const insertData: any = {
            spotify_playlist_url: spotifyPlaylistUrl,
            playlist_name: playlistName,
            total_tracks: tracks.length,
            status: 'pending',
        };

        if (user) {
            insertData.user_id = user.id;
        }

        const { data: task, error: taskError } = await supabase
            .from('download_tasks')
            .insert(insertData)
            .select()
            .single();

        if (taskError) throw taskError;

        // 2. Inserir tracks na fila
        const tracksToInsert = tracks.map((t, idx) => ({
            task_id: task.id,
            track_number: idx + 1,
            ...t,
            status: 'pending'
        }));
        await supabase.from('playlist_tracks').insert(tracksToInsert);

        // 3. Criar job na fila
        const { error: jobError } = await supabase
            .from('jobs')
            .insert({
                task_id: task.id,
                payload: {
                    spotifyPlaylistUrl,
                    userId: user?.id || null,
                    downloadTaskId: task.id,
                },
            });

        if (jobError) throw jobError;

        return NextResponse.json({ downloadTaskId: task.id, status: 'pending' });
    } catch (err: any) {
        console.error('Erro ao iniciar download:', err);
        return NextResponse.json({ error: err.message || 'Erro interno' }, { status: 500 });
    }
}
