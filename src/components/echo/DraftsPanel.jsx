import { useEffect, useState } from 'react';
import { FileText, Trash2, Inbox, BookmarkPlus } from 'lucide-react';
import { Sheet, Button, Input, useToast } from '@/components/ui/primitives';
import { listDrafts, deleteDraft, relativeTime } from '@/lib/drafts';
import { countWords } from '@/lib/sentences';

export default function DraftsPanel({ open, onOpenChange, onLoad, onSaveCurrent, canSave }) {
  const [drafts, setDrafts] = useState([]);
  const [query, setQuery] = useState('');
  const { toast } = useToast();

  useEffect(() => {
    if (open) { setDrafts(listDrafts()); setQuery(''); }
  }, [open]);

  const remove = (e, id) => {
    e.stopPropagation();
    deleteDraft(id);
    setDrafts(listDrafts());
  };

  const save = () => {
    try {
      const draft = onSaveCurrent();
      if (draft) {
        setDrafts(listDrafts());
        toast({ title: 'Draft saved', description: draft.title });
      }
    } catch (err) {
      toast({ variant: 'destructive', title: 'Could not save', description: err.message });
    }
  };

  const needle = query.trim().toLowerCase();
  const filtered = needle
    ? drafts.filter((d) => `${d.title} ${d.text}`.toLowerCase().includes(needle))
    : drafts;

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Drafts"
      description="Saved in this browser only — nothing is uploaded."
    >
      <Button
        onClick={save}
        disabled={!canSave}
        className="gap-2 bg-gradient-to-r from-echo to-lilac text-white hover:opacity-90"
      >
        <BookmarkPlus className="h-4 w-4" /> Save current text
      </Button>

      {drafts.length > 3 && (
        <Input placeholder="Search drafts…" value={query} onChange={(e) => setQuery(e.target.value)} />
      )}

      <div className="-mx-6 flex-1 overflow-y-auto px-6">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-14 text-muted-foreground">
            <Inbox className="h-8 w-8" />
            <p className="text-sm">{drafts.length ? 'Nothing matches.' : 'No drafts yet.'}</p>
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {filtered.map((d) => (
              <li key={d.id}>
                {/* The row is a plain container: nesting the delete control
                    inside the load button is invalid HTML and leaves the
                    delete unreachable by keyboard. */}
                <div className="group flex items-start gap-1 rounded-lg border border-border/60
                                transition-colors focus-within:border-lilac/40
                                hover:border-lilac/40 hover:bg-lilac/5">
                  <button
                    type="button"
                    onClick={() => onLoad(d)}
                    className="flex min-w-0 flex-1 items-start gap-3 rounded-l-lg p-3 text-left
                               focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lilac/50"
                  >
                    <FileText className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{d.title}</span>
                      <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                        {d.text.slice(0, 90)}
                      </span>
                      <span className="mt-1 block text-xs text-muted-foreground/60">
                        {countWords(d.text).toLocaleString()} words · {relativeTime(d.savedAt)}
                      </span>
                    </span>
                  </button>
                  <button
                    type="button"
                    aria-label={`Delete draft: ${d.title}`}
                    onClick={(e) => remove(e, d.id)}
                    className="mr-1 mt-2 rounded p-1.5 text-muted-foreground opacity-0 transition
                               hover:text-destructive focus-visible:opacity-100 focus-visible:outline-none
                               focus-visible:ring-2 focus-visible:ring-destructive/50 group-hover:opacity-100"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Sheet>
  );
}
