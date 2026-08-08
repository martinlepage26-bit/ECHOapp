import { useCallback, useMemo, useRef, useState, type JSX } from "react";
import { createDraft, fetchSampleText, parseFile, synthesize, type Voice } from "../api.js";
import { playAudio, stopAudio, pauseAudio, resumeAudio } from "../audio.js";
import { speakSystem, stopSystem, pauseSystem, resumeSystem } from "../system-speech.js";
import { wordCount, charCount, formatDuration, renderWords } from "../text.js";

interface Props {
  text: string;
  setText: (text: string) => void;
  title: string;
  setTitle: (title: string) => void;
  speed: number;
  setSpeed: (speed: number) => void;
  selectedVoice?: Voice;
  onError: (msg: string | null) => void;
  onSave: () => void;
}

export function Readback({
  text,
  setText,
  title,
  setTitle,
  speed,
  setSpeed,
  selectedVoice,
  onError,
  onSave,
}: Props) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [activeWord, setActiveWord] = useState<number>(-1);
  const [status, setStatus] = useState<string>("Ready");
  const [fileName, setFileName] = useState<string>("No file selected yet.");
  const words = useMemo(() => renderWords(text), [text]);
  const outputRef = useRef<HTMLDivElement>(null);
  const activeProvider = useRef<"system" | "clone" | null>(null);

  const handleWord = useCallback((index: number) => {
    setActiveWord(index);
    if (index >= 0) {
      const el = outputRef.current?.querySelector(`[data-word-index="${index}"]`);
      el?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, []);

  const handleEnded = useCallback(() => {
    activeProvider.current = null;
    setIsPlaying(false);
    setIsPaused(false);
    setActiveWord(-1);
    setStatus("Ready");
  }, []);

  const play = useCallback(async () => {
    if (!text.trim() || !selectedVoice) return;
    onError(null);

    if (selectedVoice.provider === "system") {
      activeProvider.current = "system";
      setStatus(`Playing · ${selectedVoice.name}`);
      setIsPlaying(true);
      setIsPaused(false);
      speakSystem(
        text,
        selectedVoice.id,
        speed,
        handleWord,
        handleEnded,
        (err) => {
          activeProvider.current = null;
          setStatus("Error");
          onError(err.message);
          setIsPlaying(false);
        },
      );
      return;
    }

    setStatus("Synthesizing…");
    try {
      activeProvider.current = "clone";
      const result = await synthesize(text, selectedVoice.id, speed);
      setStatus(`Playing · ${selectedVoice.name}`);
      setIsPlaying(true);
      setIsPaused(false);
      playAudio(
        result.audio_base64,
        result.mime,
        result.words,
        handleWord,
        handleEnded,
      );
    } catch (e) {
      activeProvider.current = null;
      setStatus("Error");
      onError(String((e as Error).message || e));
      setIsPlaying(false);
    }
  }, [text, selectedVoice, speed, onError, handleWord, handleEnded]);

  const pause = () => {
    if (activeProvider.current === "system") {
      pauseSystem();
    } else {
      pauseAudio();
    }
    setIsPaused(true);
    setStatus("Paused");
  };

  const resume = () => {
    if (activeProvider.current === "system") {
      resumeSystem();
    } else {
      resumeAudio();
    }
    setIsPaused(false);
    setStatus("Playing");
  };

  const stop = () => {
    stopAudio();
    stopSystem();
    activeProvider.current = null;
    setIsPlaying(false);
    setIsPaused(false);
    setActiveWord(-1);
    setStatus("Ready");
  };

  const handleFile = async (file: File) => {
    onError(null);
    setFileName(file.name);
    setStatus("Parsing…");
    try {
      const parsed = await parseFile(file);
      setText(parsed.text);
      if (!title.trim()) setTitle(file.name.replace(/\.[^.]+$/, ""));
      setStatus("Ready");
    } catch (e) {
      setStatus("Error");
      onError(String((e as Error).message || e));
    }
  };

  const loadSample = async () => {
    onError(null);
    try {
      setText(await fetchSampleText());
      setTitle("Sample");
    } catch (e) {
      onError(String((e as Error).message || e));
    }
  };

  const saveDraft = async () => {
    if (!text.trim()) return;
    onError(null);
    try {
      await createDraft(title.trim() || "Untitled draft", text);
      onSave();
      setStatus("Saved to library");
    } catch (e) {
      onError(String((e as Error).message || e));
    }
  };

  const duration = useMemo(() => {
    // Rough estimate: 0.14s per word adjusted by speed.
    const seconds = words.length * 0.14 / Math.max(0.5, speed);
    return formatDuration(seconds);
  }, [words.length, speed]);

  return (
    <section className="echo-grid" aria-labelledby="echo-workbench-title">
      <section className="echo-panel echo-editor-panel">
        <div className="echo-panel-head">
          <div>
            <p className="echo-eyebrow">Source</p>
            <h2 id="echo-workbench-title">Intake</h2>
          </div>
          <div className="echo-panel-actions">
            <button className="echo-ghost-button" type="button" onClick={loadSample}>
              Load sample
            </button>
            <button className="echo-ghost-button" type="button" onClick={() => { setText(""); setTitle(""); setFileName("No file selected yet."); }}>
              Clear
            </button>
          </div>
        </div>

        <div className="echo-editor-surface">
          <label className="echo-field echo-field-full">
            <span className="echo-field-label">Title</span>
            <input
              className="echo-input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Draft title"
            />
          </label>

          <div
            className="echo-dropzone"
            onClick={() => document.getElementById("echo-file-input")?.click()}
            onDragOver={(e) => { e.preventDefault(); }}
            onDrop={(e) => {
              e.preventDefault();
              const file = e.dataTransfer.files[0];
              if (file) handleFile(file);
            }}
          >
            <div>
              <p><strong>Drop a file here.</strong></p>
              <p>
                Supports <code>.txt</code>, <code>.md</code>, <code>.docx</code>, and <code>.pdf</code>.
              </p>
            </div>
            <span className="echo-dropzone-cta">Choose file</span>
            <input
              id="echo-file-input"
              className="echo-file-input"
              type="file"
              accept=".txt,.md,.markdown,.docx,.pdf"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
            />
          </div>

          <div className="echo-meta-row">
            <p className="echo-file-meta">{fileName}</p>
            <p className="echo-text-meta">{wordCount(text)} words · {charCount(text)} chars · ~{duration}</p>
          </div>

          <label className="echo-field echo-field-full" htmlFor="echo-text">
            <span className="echo-field-label">Text Body</span>
            <textarea
              id="echo-text"
              className="echo-textarea"
              rows={18}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Paste writing here or import a file."
            />
          </label>
        </div>
      </section>

      <aside className="echo-panel echo-side-panel">
        <div className="echo-transport-strip">
          <span className={`echo-header-ready ${isPlaying && !isPaused ? "is-ready" : isPaused ? "is-idle" : ""}`}>
            {status}
          </span>
          <div className="echo-runner">
            <button
              className="echo-button primary"
              type="button"
              onClick={isPaused ? resume : play}
              aria-label="Play"
            >
              ▶
            </button>
            <button className="echo-button secondary" type="button" onClick={pause} aria-label="Pause">
              ❚❚
            </button>
            <button className="echo-button secondary danger" type="button" onClick={stop} aria-label="Stop">
              ■
            </button>
          </div>
          <div className="echo-transport-tuning">
            <label className="echo-mini-tuning" htmlFor="echo-rate">
              <span className="echo-mini-tuning-label">Speed</span>
              <input
                id="echo-rate"
                type="range"
                min={0.6}
                max={1.6}
                step={0.05}
                value={speed}
                onChange={(e) => setSpeed(Number(e.target.value))}
              />
              <span className="echo-mini-tuning-value">{speed.toFixed(2)}</span>
            </label>
          </div>
        </div>
        <button className="echo-button primary" type="button" onClick={saveDraft} disabled={!text.trim()}>
          Save draft
        </button>
      </aside>

      <section className="echo-panel echo-reader-panel" aria-labelledby="echo-reader-title">
        <div className="echo-panel-head">
          <div>
            <p className="echo-eyebrow">Readback</p>
            <h2 id="echo-reader-title">Read Along</h2>
          </div>
        </div>
        <div className="echo-output-shell">
          <div className="echo-output" ref={outputRef}>
            {words.length === 0 ? (
              <span className="echo-word">Enter or import text to begin.</span>
            ) : (
              words.map(({ word, index }) => (
                <span
                  key={index}
                  data-word-index={index}
                  className={`echo-word ${activeWord === index ? "is-active" : activeWord > index ? "was-active" : ""}`}
                >
                  {word}
                </span>
              )).reduce<(string | JSX.Element)[]>((acc, span, i) => {
                if (i > 0) acc.push(" ");
                acc.push(span);
                return acc;
              }, [])
            )}
          </div>
        </div>
      </section>
    </section>
  );
}
