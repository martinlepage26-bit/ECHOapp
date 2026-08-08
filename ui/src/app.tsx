import { useEffect, useMemo, useState } from "react";
import { Readback } from "./components/Readback.js";
import { Library } from "./components/Library.js";
import { VoiceSelect } from "./components/VoiceSelect.js";
import { fetchVoices, listDrafts, type Voice, type Draft } from "./api.js";
import { stopAudio } from "./audio.js";
import { ensureVoicesLoaded, getGoogleVoices, stopSystem } from "./system-speech.js";

type Screen = "readback" | "library";

const STORAGE_KEY = "echo:v3:state";

interface PersistedState {
  text: string;
  title: string;
  voiceId: string;
  speed: number;
}

function loadPersisted(): Partial<PersistedState> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Partial<PersistedState>) : {};
  } catch {
    return {};
  }
}

function savePersisted(state: PersistedState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // ignore
  }
}

function pickDefaultVoice(voices: Voice[]): string {
  // Prefer a Google English system voice if available, then fall back to the first clone voice.
  const googleEn = voices.find((v) => v.provider === "system" && v.id === "Google US English");
  if (googleEn) return googleEn.id;
  const anySystem = voices.find((v) => v.provider === "system");
  if (anySystem) return anySystem.id;
  return voices[0]?.id || "";
}

export function App() {
  const [screen, setScreen] = useState<Screen>("readback");
  const [voices, setVoices] = useState<Voice[]>([]);
  const [defaultVoice, setDefaultVoice] = useState<string>("");
  const [selectedVoiceId, setSelectedVoiceId] = useState<string>("");
  const [text, setText] = useState<string>("");
  const [title, setTitle] = useState<string>("");
  const [speed, setSpeed] = useState<number>(1);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Load clone voices from API and system voices from the browser.
  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetchVoices(),
      ensureVoicesLoaded().then(getGoogleVoices).catch(() => []),
    ])
      .then(([catalog, systemVoices]) => {
        if (cancelled) return;
        const allVoices: Voice[] = [...systemVoices, ...catalog.voices];
        const effectiveDefault = pickDefaultVoice(allVoices) || catalog.default;
        const persisted = loadPersisted();
        const voiceId =
          persisted.voiceId && allVoices.some((v) => v.id === persisted.voiceId)
            ? persisted.voiceId
            : effectiveDefault;
        setVoices(allVoices);
        setDefaultVoice(effectiveDefault);
        setSelectedVoiceId(voiceId);
        setText(persisted.text || "");
        setTitle(persisted.title || "");
        setSpeed(persisted.speed ?? 1);
      })
      .catch((e) => setError(String(e.message || e)));
    return () => {
      cancelled = true;
    };
  }, []);

  // Persist text/title/voice/speed changes.
  useEffect(() => {
    savePersisted({ text, title, voiceId: selectedVoiceId, speed });
  }, [text, title, selectedVoiceId, speed]);

  const refreshDrafts = async () => {
    try {
      setDrafts(await listDrafts());
    } catch (e) {
      setError(String((e as Error).message || e));
    }
  };

  useEffect(() => {
    refreshDrafts();
  }, []);

  const selectedVoice = useMemo(
    () => voices.find((v) => v.id === selectedVoiceId) || voices[0],
    [voices, selectedVoiceId],
  );

  const loadDraft = (draft: Draft) => {
    setTitle(draft.title);
    setText(draft.text);
    setScreen("readback");
  };

  const switchScreen = (next: Screen) => {
    setScreen(next);
    stopAudio();
    stopSystem();
  };

  return (
    <div className="echo-main">
      <header className="echo-header">
        <div className="echo-header-hero">
          <a className="echo-brand" href="/" onClick={(e) => { e.preventDefault(); setScreen("readback"); }}>
            <span className="echo-mark">ECHO</span>
          </a>
          <nav className="echo-panel-actions">
            <button
              className={`echo-button ${screen === "readback" ? "primary" : "secondary"}`}
              onClick={() => switchScreen("readback")}
            >
              Readback
            </button>
            <button
              className={`echo-button ${screen === "library" ? "primary" : "secondary"}`}
              onClick={() => switchScreen("library")}
            >
              Library
            </button>
          </nav>
        </div>
        <VoiceSelect
          voices={voices}
          selectedId={selectedVoiceId}
          defaultId={defaultVoice}
          onSelect={setSelectedVoiceId}
        />
        {error && (
          <p className="echo-status" data-tone="error">
            {error}
          </p>
        )}
      </header>

      {screen === "readback" ? (
        <Readback
          text={text}
          setText={setText}
          title={title}
          setTitle={setTitle}
          speed={speed}
          setSpeed={setSpeed}
          selectedVoice={selectedVoice}
          onError={setError}
          onSave={refreshDrafts}
        />
      ) : (
        <Library drafts={drafts} onLoad={loadDraft} onRefresh={refreshDrafts} onError={setError} />
      )}
    </div>
  );
}
