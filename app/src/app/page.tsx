"use client";

import { useEffect, useState, useRef } from "react";
import { createClient } from "@/utils/supabase/client";
import {
  Music2,
  Play,
  Search,
  Download,
  Clock,
  Zap,
  CheckCircle2,
  AlertCircle,
  Disc,
  ArrowLeft,
  ChevronRight,
  History,
  Trash2
} from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface Track {
  spotify_track_id: string;
  title: string;
  artist: string;
  status: string;
  download_url?: string;
  album_cover_url?: string;
}

interface Task {
  id: string;
  status: string;
  playlist_name: string;
  total_tracks: number;
  tracks_downloaded: number;
  zip_file_url?: string;
  error_message?: string | null;
  created_at: string;
}

export default function App() {
  const [view, setView] = useState<'idle' | 'progress' | 'history'>('idle');
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTask, setActiveTask] = useState<Task | null>(null);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [history, setHistory] = useState<Task[]>([]);
  const [timeLeft, setTimeLeft] = useState<number | null>(null);

  const supabase = createClient();
  const progressInterval = useRef<NodeJS.Timeout | null>(null);

  // Load History
  useEffect(() => {
    const fetchHistory = async () => {
      const { data } = await supabase
        .from("download_tasks")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(10);
      if (data) setHistory(data);
    };
    fetchHistory();
  }, [supabase, view]);

  // Realtime subscription for active task
  useEffect(() => {
    if (!activeTask) return;

    const channel = supabase
      .channel(`task_${activeTask.id}`)
      .on("broadcast" as any, { event: "task_update" }, (payload: any) => {
        setActiveTask((prev) => prev ? ({ ...prev, ...payload.payload }) : null);
      })
      .on("broadcast" as any, { event: "track_update" }, (payload: any) => {
        setTracks((prev) =>
          prev.map(t => t.spotify_track_id === payload.payload.trackId
            ? { ...t, status: payload.payload.status, download_url: payload.payload.downloadUrl }
            : t
          )
        );
      })
      .subscribe();

    const fetchTracks = async () => {
      const { data } = await supabase
        .from("playlist_tracks")
        .select("*")
        .eq("task_id", activeTask.id)
        .order("track_number", { ascending: true });
      if (data) setTracks(data);
    };
    fetchTracks();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [activeTask?.id, supabase]);

  // Expiration Timer Effect
  useEffect(() => {
    if (activeTask?.status === 'completed' && activeTask.zip_file_url) {
      setTimeLeft(60);
      const timer = setInterval(() => {
        setTimeLeft((prev) => (prev !== null && prev > 0) ? prev - 1 : 0);
      }, 1000);
      return () => clearInterval(timer);
    } else {
      setTimeLeft(null);
    }
  }, [activeTask?.status, activeTask?.zip_file_url]);

  const handleInitiate = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      if (!url.includes("spotify.com/playlist/")) {
        throw new Error("Link inválido. Use um link de playlist do Spotify.");
      }

      const res = await fetch("/api/download/initiate", {
        method: "POST",
        body: JSON.stringify({ spotifyPlaylistUrl: url }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      // Fetch the full task object
      const { data: taskData } = await supabase
        .from("download_tasks")
        .select("*")
        .eq("id", data.downloadTaskId)
        .single();

      setActiveTask(taskData);
      setView('progress');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const reset = () => {
    setView('idle');
    setActiveTask(null);
    setTracks([]);
    setUrl("");
  };

  const percentage = activeTask?.total_tracks ? Math.round((activeTask.tracks_downloaded / activeTask.total_tracks) * 100) : 0;

  return (
    <div className="min-h-screen bg-[#000000] text-white selection:bg-[#1DB954]/30 font-sans overflow-x-hidden">
      {/* Background Decor */}
      <div className="fixed top-0 left-0 w-full h-full pointer-events-none -z-10">
        <div className="absolute top-[-10%] left-[-10%] w-[50%] h-[50%] bg-[#1DB954]/5 blur-[120px] rounded-full" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] bg-[#1DB954]/5 blur-[120px] rounded-full" />
      </div>

      {/* Nav */}
      <nav className="h-20 px-6 md:px-12 flex items-center justify-between sticky top-0 z-50 bg-black/60 backdrop-blur-xl border-b border-white/5">
        <div className="flex items-center gap-3 group cursor-pointer" onClick={reset}>
          <div className="bg-[#1DB954] p-2 rounded-full shadow-[0_0_20px_rgba(29,185,84,0.3)]">
            <Music2 size={24} className="text-black" strokeWidth={3} />
          </div>
          <span className="text-2xl font-black tracking-tighter">SpotDown</span>
        </div>

        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            className="text-gray-400 hover:text-white font-bold"
            onClick={() => setView(view === 'history' ? 'idle' : 'history')}
          >
            <History size={20} className="mr-2" />
            Histórico
          </Button>
          <div className="h-8 w-8 bg-[#1DB954] rounded-full flex items-center justify-center text-black font-black text-xs">
            L
          </div>
        </div>
      </nav>

      <main className="max-w-6xl mx-auto px-6 py-12">
        {view === 'idle' && (
          <div className="flex flex-col items-center text-center space-y-16 py-20 animate-in fade-in slide-in-from-bottom-8 duration-1000">
            <div className="space-y-6">
              <h1 className="text-6xl md:text-8xl font-black tracking-tighter leading-[0.9] italic">
                SUA MÚSICA <br />
                <span className="text-[#1DB954] not-italic">OFFLINE.</span>
              </h1>
              <p className="text-xl text-gray-400 font-medium max-w-xl mx-auto">
                Baixe playlists completas do Spotify com qualidade máxima de 320kbps. Simples e sem frescuras.
              </p>
            </div>

            <div className="w-full max-w-2xl px-4">
              <form onSubmit={handleInitiate} className="flex items-center bg-[#121212] border border-white/10 rounded-full hover:bg-[#181818] transition-all group overflow-hidden h-16 shadow-2xl">
                <Input
                  className="flex-1 bg-transparent border-none text-white h-full px-8 focus-visible:ring-0 text-lg font-bold placeholder:text-gray-600"
                  placeholder="Cole o link da playlist do Spotify aqui..."
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                />
                <Button
                  disabled={loading}
                  className="bg-[#1DB954] hover:bg-[#1ed760] text-black font-black px-10 rounded-full h-[80%] mr-2 transition-all shrink-0 active:scale-95 flex items-center justify-center"
                >
                  {loading ? (
                    <div className="h-4 w-4 border-2 border-black border-t-transparent rounded-full animate-spin" />
                  ) : (
                    "BAIXAR"
                  )}
                </Button>
              </form>
              {error && (
                <p className="mt-4 text-red-500 font-bold bg-red-500/10 py-2 px-6 rounded-full inline-block border border-red-500/20">
                  {error}
                </p>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-8 w-full">
              {[
                { icon: <Zap />, title: "320kbps", desc: "Qualidade de áudio superior" },
                { icon: <Disc />, title: "Tags ID3", desc: "Capas e metadados inclusos" },
                { icon: <Clock />, title: "No Limit", desc: "Baixe quantas quiser" }
              ].map((item, i) => (
                <div key={i} className="bg-[#121212] p-8 rounded-[32px] border border-white/5 hover:bg-[#181818] transition-colors group">
                  <div className="w-12 h-12 bg-white/5 rounded-xl flex items-center justify-center mb-6 group-hover:bg-[#1DB954] group-hover:text-black transition-all">
                    {item.icon}
                  </div>
                  <h3 className="text-xl font-bold mb-2">{item.title}</h3>
                  <p className="text-gray-500 font-medium text-sm">{item.desc}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {view === 'progress' && activeTask && (
          <div className="space-y-12 animate-in fade-in zoom-in duration-500">
            <div className="flex flex-col md:flex-row gap-8 items-start md:items-end justify-between">
              <div className="space-y-4">
                <button onClick={reset} className="flex items-center gap-2 text-gray-500 hover:text-white font-bold transition-colors">
                  <ArrowLeft size={20} />
                  Voltar
                </button>
                <h2 className="text-4xl md:text-6xl font-black italic tracking-tighter">
                  {activeTask.playlist_name || "Preparando..."}
                </h2>
              </div>

              {activeTask.status === 'completed' && activeTask.zip_file_url && (
                <div className="flex flex-col items-center md:items-end gap-2 w-full md:w-auto">
                  <a href={activeTask.zip_file_url} download className="w-full">
                    <Button className="w-full bg-[#1DB954] hover:bg-[#1ed760] text-black font-black h-16 px-12 rounded-full text-xl shadow-[0_0_30px_rgba(29,185,84,0.3)] animate-bounce relative overflow-hidden">
                      <Download size={24} className="mr-3" />
                      BAIXAR TUDO (.ZIP)
                      {timeLeft !== null && (
                        <div className="absolute bottom-0 left-0 h-1 bg-black/20 transition-all duration-1000" style={{ width: `${(timeLeft / 60) * 100}%` }} />
                      )}
                    </Button>
                  </a>
                  {timeLeft !== null && (
                    <span className="text-[10px] font-black uppercase tracking-widest text-amber-500 animate-pulse">
                      Link expira em: {timeLeft}s
                    </span>
                  )}
                </div>
              )}

              {activeTask.status === 'expired' && (
                <div className="bg-red-500/10 border border-red-500/20 px-6 py-3 rounded-full flex items-center gap-2 text-red-500 font-bold text-sm">
                  <Clock size={16} /> Link de download expirado para economizar espaço
                </div>
              )}
            </div>

            {activeTask.error_message && (
              <div className="bg-amber-500/10 border border-amber-500/20 p-6 rounded-[32px] flex items-start gap-4 animate-in fade-in slide-in-from-top-4 duration-500">
                <AlertCircle className="text-amber-500 shrink-0 mt-1" size={24} />
                <div className="space-y-1">
                  <h4 className="font-bold text-amber-500">Atenção</h4>
                  <p className="text-amber-500/80 text-sm font-medium leading-relaxed">
                    {activeTask.error_message}
                  </p>
                </div>
              </div>
            )}


            <div className="bg-[#121212] rounded-[40px] border border-white/5 p-8 md:p-12 space-y-8 shadow-2xl relative overflow-hidden">
              <div className="absolute top-0 right-0 p-12 opacity-[0.03] rotate-12">
                <Disc size={300} className="text-[#1DB954]" />
              </div>

              <div className="relative z-10 space-y-6">
                <div className="flex justify-between items-end text-sm font-black uppercase tracking-widest mb-2">
                  <span className="text-gray-500">Progresso Geral</span>
                  <span className="text-[#1DB954]">{percentage}%</span>
                </div>
                <div className="h-6 bg-black/50 rounded-full p-1.5 border border-white/5 overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-[#1DB954] to-[#1ed760] rounded-full transition-all duration-700 shadow-[0_0_20px_rgba(29,185,84,0.5)]"
                    style={{ width: `${percentage}%` }}
                  />
                </div>

                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                  {[
                    { label: "Músicas", val: activeTask.total_tracks },
                    { label: "Baixadas", val: activeTask.tracks_downloaded, color: 'text-[#1DB954]' },
                    { label: "Status", val: activeTask.status.toUpperCase(), isBadge: true },
                    { label: "ID", val: activeTask.id.split('-')[0] }
                  ].map((s, i) => (
                    <div key={i} className="bg-black/40 p-6 rounded-3xl border border-white/5 backdrop-blur-sm">
                      <p className="text-[10px] font-black text-gray-500 uppercase tracking-widest mb-2">{s.label}</p>
                      {s.isBadge ? (
                        <Badge className="bg-[#1DB954]/10 text-[#1DB954] border-none font-bold uppercase text-[10px] px-3 py-1">
                          {s.val}
                        </Badge>
                      ) : (
                        <p className={`text-2xl font-black ${s.color || 'text-white'}`}>{s.val}</p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-2">
              <h3 className="text-xs font-black text-gray-600 uppercase tracking-[0.3em] px-4 mb-2">Músicas da Playlist</h3>
              {tracks.map((track, i) => (
                <div key={track.spotify_track_id} className="group flex items-center justify-between p-4 rounded-3xl bg-[#121212]/50 border border-transparent hover:border-white/5 hover:bg-white/[0.03] transition-all">
                  <div className="flex items-center gap-6">
                    <span className="w-6 text-sm font-bold text-gray-700">{i + 1}</span>
                    <div className="w-14 h-14 rounded-xl bg-gray-900 overflow-hidden border border-white/10 shrink-0 relative">
                      {track.album_cover_url ? (
                        <img src={track.album_cover_url} alt="" className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500" />
                      ) : (
                        <Music2 size={24} className="absolute inset-0 m-auto text-gray-700" />
                      )}
                      {track.status === 'downloading' && (
                        <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
                          <div className="h-5 w-5 border-2 border-[#1DB954] border-t-transparent rounded-full animate-spin" />
                        </div>
                      )}
                    </div>
                    <div>
                      <h4 className="font-bold text-gray-200 group-hover:text-white transition-colors">{track.title}</h4>
                      <p className="text-sm text-gray-500 font-medium">{track.artist}</p>
                    </div>
                  </div>

                  <div className="flex items-center gap-6">
                    {track.status === 'completed' ? (
                      <div className="text-[#1DB954] flex items-center gap-2 text-xs font-black uppercase tracking-widest">
                        <CheckCircle2 size={16} />
                        <span className="hidden md:inline">Pronto</span>
                      </div>
                    ) : track.status === 'failed' ? (
                      <div className="text-red-500 flex items-center gap-2 text-xs font-black uppercase tracking-widest">
                        <AlertCircle size={16} />
                        <span className="hidden md:inline">Erro</span>
                      </div>
                    ) : (
                      <div className="text-gray-600 italic text-xs font-black uppercase tracking-widest animate-pulse">
                        {track.status}...
                      </div>
                    )}

                    {track.download_url && (
                      <a href={track.download_url} download target="_blank">
                        <Button size="icon" variant="ghost" className="rounded-full hover:bg-[#1DB954] hover:text-black transition-all">
                          <Download size={18} />
                        </Button>
                      </a>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {view === 'history' && (
          <div className="space-y-12 animate-in fade-in slide-in-from-right-8 duration-500">
            <div className="flex items-center justify-between">
              <h2 className="text-4xl font-black tracking-tighter italic">SEU <span className="text-[#1DB954] not-italic">HISTÓRICO</span></h2>
              <Button variant="ghost" onClick={() => setView('idle')} className="font-bold text-gray-400">Fechar</Button>
            </div>

            <div className="grid gap-4">
              {history.length === 0 ? (
                <div className="text-center py-20 bg-[#121212] rounded-[40px] border border-white/5">
                  <History size={48} className="mx-auto text-gray-700 mb-4" />
                  <p className="text-gray-500 font-bold uppercase tracking-widest">Nenhum download ainda</p>
                </div>
              ) : (
                history.map((h) => (
                  <div
                    key={h.id}
                    className="group bg-[#121212] p-6 rounded-[32px] border border-white/5 hover:border-[#1DB954]/30 transition-all flex flex-col md:flex-row justify-between items-center gap-6"
                  >
                    <div className="flex items-center gap-6">
                      <div className="w-16 h-16 bg-black rounded-2xl flex items-center justify-center text-[#1DB954]">
                        <Disc size={32} />
                      </div>
                      <div>
                        <h4 className="text-xl font-bold">{h.playlist_name || "Download"}</h4>
                        <p className="text-gray-500 text-sm font-medium">
                          {new Date(h.created_at).toLocaleDateString()} • {h.total_tracks} músicas
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <Button
                        variant="outline"
                        className="border-white/10 rounded-full font-bold hover:bg-white/5"
                        onClick={() => {
                          setActiveTask(h);
                          setView('progress');
                        }}
                      >
                        Ver Detalhes
                      </Button>
                      {h.zip_file_url && (
                        <a href={h.zip_file_url} download>
                          <Button className="bg-[#1DB954]/10 text-[#1DB954] hover:bg-[#1DB954] hover:text-black rounded-full font-bold">
                            ZIP
                          </Button>
                        </a>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </main>

      {/* Credits */}
      <footer className="py-20 flex flex-col items-center gap-6 opacity-40 hover:opacity-100 transition-opacity">
        <div className="flex items-center gap-2">
          <div className="bg-gray-500 p-1 rounded-full"><Music2 size={12} className="text-black" /></div>
          <span className="text-[10px] font-black uppercase tracking-[0.5em] text-gray-500">SpotDown 2025</span>
        </div>
      </footer>
    </div>
  );
}
