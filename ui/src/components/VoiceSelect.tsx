import type { Voice } from "../api.js";

interface Props {
  voices: Voice[];
  selectedId: string;
  defaultId: string;
  onSelect: (id: string) => void;
}

export function VoiceSelect({ voices, selectedId, defaultId, onSelect }: Props) {
  const selected = voices.find((v) => v.id === selectedId) || voices.find((v) => v.id === defaultId);

  return (
    <div className="echo-header-profiles">
      <div className="echo-profile-row echo-profile-row-system">
        <label className="echo-field-label" htmlFor="echo-voice">
          Voice
        </label>
        <select
          id="echo-voice"
          className="echo-input echo-header-voice-select"
          style={{ display: "block", width: "min(100%, 24rem)" }}
          value={selectedId}
          onChange={(e) => onSelect(e.target.value)}
        >
          {voices.map((voice) => (
            <option key={voice.id} value={voice.id}>
              {voice.name} · {voice.provider === "clone" ? "clone" : "Workers AI"}
              {voice.tag ? ` · ${voice.tag}` : ""}
            </option>
          ))}
        </select>
      </div>
      {selected && (
        <p className="echo-voice-meta" style={{ display: "block" }}>
          {selected.provider === "clone"
            ? "Served by the local clone sidecar."
            : "Served by Cloudflare Workers AI."}
        </p>
      )}
    </div>
  );
}
