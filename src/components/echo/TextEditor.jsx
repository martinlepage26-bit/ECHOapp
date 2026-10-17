import { useCallback, useRef, useState } from 'react';
import { FileUp, Loader2 } from 'lucide-react';

/**
 * TextEditor — the paste-and-drop surface.
 *
 * A plain textarea, deliberately. The earlier build auto-grew the element to
 * its scrollHeight on every keystroke, which forces a full layout pass; at
 * 10,000 words that is a visible stall per character. Letting the textarea
 * scroll inside a fixed box keeps typing constant-time at any length.
 */
export default function TextEditor({ text, onChange, onDropFile, importing, importNote }) {
  const [dragging, setDragging] = useState(false);
  const depth = useRef(0);

  const onDragEnter = useCallback((e) => {
    e.preventDefault();
    depth.current += 1;
    if (e.dataTransfer?.types?.includes('Files')) setDragging(true);
  }, []);

  const onDragLeave = useCallback((e) => {
    e.preventDefault();
    depth.current -= 1;
    if (depth.current <= 0) { depth.current = 0; setDragging(false); }
  }, []);

  const onDrop = useCallback((e) => {
    e.preventDefault();
    depth.current = 0;
    setDragging(false);
    const file = e.dataTransfer?.files?.[0];
    if (file) onDropFile(file);
  }, [onDropFile]);

  return (
    <div
      className="relative h-full"
      onDragEnter={onDragEnter}
      onDragOver={(e) => e.preventDefault()}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <div className="h-full overflow-y-auto px-5 py-10 md:px-8 md:py-14">
        <div className="mx-auto h-full max-w-3xl">
          <textarea
            value={text}
            onChange={(e) => onChange(e.target.value)}
            placeholder={
              'Paste text, drop a file, or pull in a page by URL.\n\n' +
              'ECHO reads it back sentence by sentence — and says amounts, ' +
              'dates and serial numbers the way a person would.'
            }
            className="h-full min-h-[55vh] w-full resize-none bg-transparent font-body text-xl
                       leading-relaxed outline-none md:text-2xl
                       placeholder:text-base placeholder:leading-relaxed placeholder:text-muted-foreground/45"
            spellCheck={false}
            autoFocus
          />
        </div>
      </div>

      {(dragging || importing) && (
        <div className="absolute inset-3 z-20 flex flex-col items-center justify-center gap-3
                        rounded-2xl border-2 border-dashed border-lilac/50 bg-background/85 backdrop-blur-sm">
          {importing ? (
            <>
              <Loader2 className="h-7 w-7 animate-spin text-lilac" />
              <p className="text-sm font-medium">{importNote || 'Reading document…'}</p>
            </>
          ) : (
            <>
              <FileUp className="h-7 w-7 text-lilac" />
              <p className="text-sm font-medium">Drop to read</p>
              <p className="text-xs text-muted-foreground">PDF, Word, EPUB, HTML, Markdown, or plain text</p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
