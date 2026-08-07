import { useMemo } from "react";
import { deleteDraft, type Draft } from "../api.js";
import { wordCount } from "../text.js";

interface Props {
  drafts: Draft[];
  onLoad: (draft: Draft) => void;
  onRefresh: () => void;
  onError: (msg: string | null) => void;
}

export function Library({ drafts, onLoad, onRefresh, onError }: Props) {
  const sorted = useMemo(
    () => [...drafts].sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at)),
    [drafts],
  );

  const remove = async (id: string) => {
    onError(null);
    try {
      await deleteDraft(id);
      onRefresh();
    } catch (e) {
      onError(String((e as Error).message || e));
    }
  };

  return (
    <section className="echo-panel echo-editor-panel" aria-labelledby="echo-library-title">
      <div className="echo-panel-head">
        <div>
          <p className="echo-eyebrow">Library</p>
          <h2 id="echo-library-title">Saved Drafts</h2>
        </div>
        <div className="echo-panel-actions">
          <button className="echo-ghost-button" type="button" onClick={onRefresh}>
            Refresh
          </button>
        </div>
      </div>
      <div className="echo-editor-surface">
        {sorted.length === 0 ? (
          <p className="echo-panel-summary">No saved drafts yet. Save one from Readback.</p>
        ) : (
          <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: "0.75rem" }}>
            {sorted.map((draft) => (
              <li
                key={draft.id}
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr auto auto",
                  gap: "0.75rem",
                  alignItems: "center",
                  padding: "0.9rem 1rem",
                  border: "1px solid var(--echo-border)",
                  borderRadius: "var(--echo-radius-panel)",
                  background: "#ffffff",
                }}
              >
                <div>
                  <strong style={{ fontSize: "0.9rem" }}>{draft.title}</strong>
                  <p className="echo-panel-summary" style={{ margin: "0.2rem 0 0", fontSize: "0.78rem" }}>
                    {wordCount(draft.text)} words · {new Date(draft.created_at).toLocaleString()}
                  </p>
                </div>
                <button className="echo-button primary" type="button" onClick={() => onLoad(draft)}>
                  Load
                </button>
                <button className="echo-button secondary danger" type="button" onClick={() => remove(draft.id)}>
                  Delete
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
