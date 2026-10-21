import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Library, AlertCircle, Languages, Eye, EyeOff } from 'lucide-react';

import { useSpeech, SAMPLE_TEXT } from '@/hooks/useSpeech';
import { extractText, ACCEPTED } from '@/lib/importFile';
import { saveDraft } from '@/lib/drafts';
import { Button, useToast, PromptDialog } from '@/components/ui/primitives';

import EchoMark from '@/components/echo/EchoMark';
import VoiceSelector from '@/components/echo/VoiceSelector';
import SpeedControl from '@/components/echo/SpeedControl';
import TextEditor from '@/components/echo/TextEditor';
import ReadAlong from '@/components/echo/ReadAlong';
import TransportBar from '@/components/echo/TransportBar';
import DraftsPanel from '@/components/echo/DraftsPanel';
import DecipherStrip from '@/components/echo/DecipherStrip';
import PharosWatermark from '@/components/echo/PharosWatermark';

export default function Home() {
  const speech = useSpeech();
  const [draftsOpen, setDraftsOpen] = useState(false);
  const [urlOpen, setUrlOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importNote, setImportNote] = useState('');
  const [follow, setFollow] = useState(true);
  const fileInputRef = useRef(null);
  const { toast } = useToast();

  const reading = speech.status !== 'idle' || speech.currentIndex >= 0;

  /* ── Keyboard transport ─────────────────────────────────────────────── */

  const shortcutRef = useRef(() => {});
  shortcutRef.current = (e) => {
    // Let focused controls and modal surfaces handle their own keys. In
    // particular, Space on Sample/Save must activate that button, not Play.
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey ||
        e.target.closest?.('input, textarea, button, select, a, [role="button"], [role="menu"], [role="dialog"], [contenteditable="true"]')) return;
    if (e.code === 'Space') {
      e.preventDefault();
      if (['playing', 'buffering'].includes(speech.status)) speech.pause(); else speech.play();
    } else if (e.code === 'Escape') {
      speech.stop();
    } else if (e.code === 'ArrowRight') {
      e.preventDefault(); speech.skip(1);
    } else if (e.code === 'ArrowLeft') {
      e.preventDefault(); speech.skip(-1);
    }
  };
  useEffect(() => {
    const handler = (e) => shortcutRef.current(e);
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  /* ── Intake ─────────────────────────────────────────────────────────── */

  const loadFile = useCallback(async (file) => {
    if (!file) return;
    setImporting(true);
    setImportNote(`Reading ${file.name}…`);
    speech.stop();
    try {
      const text = await extractText(file, (done, total) => {
        setImportNote(`Reading page ${done} of ${total}…`);
      });
      if (!text.trim()) throw new Error('That file had no readable text in it.');
      speech.setText(text);
      toast({ title: 'Loaded', description: file.name });
    } catch (err) {
      toast({ variant: 'destructive', title: 'Import failed', description: err.message });
    } finally {
      setImporting(false);
      setImportNote('');
    }
  }, [speech, toast]);

  const loadUrl = useCallback(async (input) => {
    setUrlOpen(false);
    setImporting(true);
    setImportNote('Fetching page…');
    speech.stop();
    try {
      // Fetched by this app's own Worker: same origin, no third-party proxy.
      // Built from the configured base rather than the current path — a
      // relative URL resolves differently at /echo than at /echo/.
      const res = await fetch(`${import.meta.env.BASE_URL}api/extract?url=${encodeURIComponent(input)}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `The page could not be fetched (${res.status}).`);
      if (!data.text?.trim()) throw new Error('No readable text was found on that page.');
      speech.setText(data.text);
      toast({ title: 'Page loaded', description: data.title || input });
    } catch (err) {
      toast({ variant: 'destructive', title: 'Fetch failed', description: err.message });
    } finally {
      setImporting(false);
      setImportNote('');
    }
  }, [speech, toast]);

  const handleSaveDraft = useCallback(() => saveDraft(speech.text), [speech.text]);

  const saveFromTransport = useCallback(() => {
    try {
      const draft = handleSaveDraft();
      if (draft) toast({ title: 'Draft saved', description: draft.title });
    } catch (err) {
      toast({ variant: 'destructive', title: 'Could not save', description: err.message });
    }
  }, [handleSaveDraft, toast]);

  /* ── Render ─────────────────────────────────────────────────────────── */

  return (
    <div className="relative flex h-[100dvh] flex-col overflow-hidden bg-background">
      <div className="pointer-events-none fixed inset-0 overflow-hidden" aria-hidden="true">
        <div className="absolute -left-40 -top-40 h-96 w-96 animate-float-slow rounded-full bg-echo/20 blur-3xl" />
        <div className="absolute -right-40 top-1/3 h-[28rem] w-[28rem] animate-float-slower rounded-full bg-lilac/20 blur-3xl" />
        <div className="absolute -bottom-40 left-1/3 h-80 w-80 animate-float-slow rounded-full bg-echo/10 blur-3xl" />
      </div>

      <header className="relative z-10 flex items-center justify-between gap-3 border-b border-border/40
                         bg-background/60 px-4 py-3 backdrop-blur-md md:px-6 md:py-4">
        <div className="flex items-center gap-2.5">
          <EchoMark isPlaying={speech.status === 'playing'} />
          <div>
            <h1 className="bg-gradient-to-r from-echo to-lilac bg-clip-text font-heading text-lg
                           font-bold leading-none tracking-tight text-transparent">
              ECHO
            </h1>
            <p className="mt-0.5 text-xs text-muted-foreground">Read aloud. Read along.</p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          {reading && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setFollow((v) => !v)}
              title={follow ? 'Auto-scroll is on' : 'Auto-scroll is off'}
              className="gap-1.5 text-muted-foreground hover:bg-echo/10 hover:text-echo"
            >
              {follow ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
              <span className="hidden sm:inline">Follow</span>
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={() => setDraftsOpen(true)}
            className="gap-2 hover:bg-lilac/10 hover:text-lilac">
            <Library className="h-4 w-4" /> Drafts
          </Button>
        </div>
      </header>

      <div className="relative z-10 flex flex-wrap items-center justify-between gap-3 border-b
                      border-border/40 bg-background/60 px-4 py-3 backdrop-blur-md md:px-6">
        <div className="flex items-center gap-2">
          <VoiceSelector
            voices={speech.voices}
            selectedVoiceId={speech.selectedVoiceId}
            selectedVoice={speech.selectedVoice}
            onSelect={speech.setSelectedVoiceId}
            voiceStatus={speech.voiceStatus}
            onRetry={speech.refreshVoice}
          />
          {speech.detectedLanguage && (
            <span className="inline-flex items-center gap-1 rounded-full border border-lilac/20
                             bg-gradient-to-r from-lilac/15 to-echo/15 px-2.5 py-1 text-xs
                             font-medium text-lilac">
              <Languages className="h-3 w-3" />
              {speech.detectedLanguage.name}
            </span>
          )}
        </div>
        <SpeedControl rate={speech.rate} onRateChange={speech.setRate} />
      </div>

      {(speech.error || speech.voiceStatus === 'unavailable') && (
        <div className="relative z-10 flex items-center gap-2 bg-destructive/10 px-4 py-2
                        text-sm text-destructive md:px-6">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {speech.error || 'Echo voice unavailable · Voix Echo indisponible'}
        </div>
      )}

      <main className="relative z-10 flex-1 overflow-hidden">
        <AnimatePresence mode="wait">
          {reading ? (
            <motion.div
              key="readalong"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              transition={{ duration: 0.25 }}
              className="absolute inset-0"
            >
              <ReadAlong
                sentences={speech.sentences}
                currentIndex={speech.currentIndex}
                onSeek={speech.seekTo}
                follow={follow}
              />
            </motion.div>
          ) : (
            <motion.div
              key="editor"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              transition={{ duration: 0.25 }}
              className="absolute inset-0"
            >
              <TextEditor
                text={speech.text}
                onChange={speech.setText}
                onDropFile={loadFile}
                importing={importing}
                importNote={importNote}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      <footer className="relative z-10 border-t border-border/40 bg-background/60 px-4 py-3
                         backdrop-blur-md md:px-6 md:py-4">
        {reading && speech.decipher && (
          // Height is reserved while reading so the transport does not hop
          // as sentences with and without numbers go by.
          <div className="mx-auto mb-3 min-h-[1.25rem] max-w-5xl">
            <DecipherStrip
              sentenceKey={speech.currentIndex}
              changes={speech.currentSpoken?.changes}
            />
          </div>
        )}
        <TransportBar
          status={speech.status}
          progress={speech.progress}
          wordCount={speech.wordCount}
          sentenceCount={speech.sentences.length}
          currentIndex={speech.currentIndex}
          estimatedSeconds={speech.estimatedSeconds}
          canStop={reading}
          decipher={speech.decipher}
          decipherAvailable={speech.decipherAvailable}
          onToggleDecipher={() => speech.setDecipher((v) => !v)}
          onPlay={speech.play}
          onPause={speech.pause}
          onStop={speech.stop}
          onSkip={speech.skip}
          onSample={() => { speech.stop(); speech.setText(SAMPLE_TEXT); }}
          onImport={() => fileInputRef.current?.click()}
          onFetchUrl={() => setUrlOpen(true)}
          onSave={saveFromTransport}
          importing={importing}
        />
      </footer>

      <PharosWatermark />

      <input
        ref={fileInputRef}
        type="file"
        accept={ACCEPTED}
        className="hidden"
        onChange={(e) => { loadFile(e.target.files?.[0]); e.target.value = ''; }}
      />

      <DraftsPanel
        open={draftsOpen}
        onOpenChange={setDraftsOpen}
        canSave={speech.wordCount > 0}
        onSaveCurrent={handleSaveDraft}
        onLoad={(d) => { speech.stop(); speech.setText(d.text); setDraftsOpen(false); }}
      />

      <PromptDialog
        open={urlOpen}
        title="Read a web page"
        description="ECHO fetches the page and reads its main text."
        placeholder="https://example.com/article"
        submitLabel="Fetch"
        onSubmit={loadUrl}
        onCancel={() => setUrlOpen(false)}
      />
    </div>
  );
}
