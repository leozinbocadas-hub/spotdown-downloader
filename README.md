# 🎵 SpotDown - Spotify Playlist Downloader

O **SpotDown** é uma solução completa para baixar playlists do Spotify com alta qualidade, integrando metadados (capa, artista, álbum) e garantindo armazenamento estável para arquivos de grande porte.

---

## 🚀 Funcionalidades Principais

- **Download em Lote:** Baixe playlists inteiras com centenas de músicas em um único ZIP.
- **Metadados Automáticos:** Tags ID3 inclusas (Capa do Álbum, Artista, Nome da track).
- **Armazenamento Profissional:** Integração com **Cloudflare R2** para suportar arquivos gigantes (sem limite de 50MB).
- **Custo Zero de Download:** Graças ao Cloudflare R2, não há cobrança por transferência de dados (egress).
- **Interface Moderna:** UI inspirada no Spotify, totalmente responsiva e em Português.
- **Pronto para Deploy:** Já configurado com Docker para uso no **Easypanel**.

---

## 🛠️ Stack Tecnológica

- **Frontend:** Next.js 14, TailwindCSS, Lucide Icons.
- **Backend (Worker):** Node.js, yt-dlp, FFmpeg.
- **Banco de Dados:** Supabase (DB + Realtime Broadcast).
- **Storage:** Cloudflare R2 (S3 Compatible).

---

## 📦 Estrutura do Projeto

```bash
├── app/    # Interface do usuário (Next.js)
├── worker/ # Processador de downloads (Node.js + Python)
└── DOCUMENTACAO.md # Guia detalhado de deploy e configuração
```

---

## ⚙️ Configuração Rápidas

Para rodar este projeto, você precisará configurar as variáveis de ambiente (`.env`) em ambas as pastas:

### Worker / App
- `NEXT_PUBLIC_SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SPOTIFY_CLIENT_ID`
- `SPOTIFY_CLIENT_SECRET`
- `R2_ACCOUNT_ID`
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`
- `R2_BUCKET_NAME`
- `R2_PUBLIC_URL`

---

## 🚀 Deploy no Easypanel

1. Crie dois serviços do tipo **App**.
2. Aponte para este repositório.
3. Defina o **Root Directory** como `/app` para o site e `/worker` para o download.
4. O sistema utilizará os `Dockerfile` já inclusos para instalar dependências como FFmpeg e Python automaticamente.

---

## 📜 Licença

Desenvolvido para uso pessoal e educacional. Verifique os termos de uso do Spotify e YouTube.

---
**Documentação técnica completa disponível no arquivo [DOCUMENTACAO.md](./DOCUMENTACAO.md).**
