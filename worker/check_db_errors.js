require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkErrors() {
    console.log('--- Verificando erros recentes no Banco de Dados ---');
    const { data: errors, error } = await supabase
        .from('playlist_tracks')
        .select('title, artist, error_message, status, updated_at')
        .eq('status', 'failed')
        .order('updated_at', { ascending: false })
        .limit(15);

    if (error) {
        console.error('Erro ao buscar do Supabase:', error);
        return;
    }

    if (!errors || errors.length === 0) {
        console.log('Nenhum erro encontrado nas tracks recentes.');
        return;
    }

    errors.forEach(err => {
        console.log(`\nTrack: ${err.title} - ${err.artist}`);
        console.log(`Erro: ${err.error_message}`);
    });
}

checkErrors();
