import { useEffect, useMemo, useState } from "react";
import { Readback } from "./components/Readback.js";
import { Library } from "./components/Library.js";
import { VoiceSelect } from "./components/VoiceSelect.js";
import { fetchVoices, type Voice, type Draft } from "./api.js";
import { listDrafts } from "./api.js";
import { stopAudio } from "./audio.js";

type Screen = "readback" | "library";

const STORAGE_KEY = "echo:v2:state";

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

export function App() {
  const [screen, setScreen] = useState<Screen>("readback");
  const [voices, setVoices] = useState<Voice[]>([]);
  const [defaultVoice, setDefaultVoice] = useState<string>("athena");
  const [selectedVoiceId, setSelectedVoiceId] = useState<string>("athena");
  const [text, setText] = useState<string>("");
  const [title, setTitle] = useState<string>("");
  const [speed, setSpeed] = useState<number>(1);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Load voices and persisted state on mount.
  useEffect(() => {
    fetchVoices()
      .then((catalog) => {
        setVoices(catalog.voices);
        setDefaultVoice(catalog.default);
        const persisted = loadPersisted();
        const voiceId = persisted.voiceId && catalog.voices.some((v) => v.id === persisted.voiceId)
          ? persisted.voiceId
          : catalog.default;
        setSelectedVoiceId(voiceId);
        setText(persisted.text || "");
        setTitle(persisted.title || "");
        setSpeed(persisted.speed ?? 1);
      })
      .catch((e) => setError(String(e.message || e)));
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
              onClick={() => setScreen("readback")}
            >
              Readback
            </button>
            <button
              className={`echo-button ${screen === "library" ? "primary" : "secondary"}`}
              onClick={() => {
                setScreen("library");
                stopAudio();
              }}
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
