import { Play, Pause, Square, SkipBack, SkipForward, Upload, Globe, BookmarkPlus, Sparkles, Loader2, Hash } from 'lucide-react';
import { Button } from '@/components/ui/primitives';

function formatDuration(seconds) {
  if (!seconds || !Number.isFinite(seconds)) return '0s';
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  if (m < 60) return s ? `${m}m ${s}s` : `${m}m`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

export default function TransportBar({
  status, progress, wordCount, sentenceCount, currentIndex, estimatedSeconds, canStop,
  decipher, onToggleDecipher, decipherAvailable,
  onPlay, onPause, onStop, onSkip, onSample, onImport, onFetchUrl, onSave, importing,
}) {
  const isPlaying = status === 'playing' || status === 'buffering';
  const isIdle = status === 'idle';
  const canPlay = sentenceCount > 0;

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-3">
      <div className="flex items-center gap-2.5">
        <Button
          onClick={isPlaying ? onPause : onPlay}
          disabled={!canPlay}
          aria-label={isPlaying ? 'Pause' : 'Play'}
          size="none"
          className="h-14 w-14 shrink-0 rounded-full bg-gradient-to-br from-echo to-lilac text-white
                     shadow-lg shadow-lilac/30 transition-all duration-200
                     hover:scale-105 hover:shadow-xl hover:shadow-lilac/40 active:scale-95"
        >
          {status === 'buffering' ? <Loader2 className="h-6 w-6 animate-spin" /> : isPlaying ? <Pause className="h-6 w-6" /> : <Play className="ml-0.5 h-6 w-6" />}
        </Button>

        <div className="flex shrink-0 items-center gap-1">
          <Button variant="ghost" size="icon" onClick={() => onSkip(-1)} disabled={!canPlay}
            aria-label="Previous sentence" className="rounded-full">
            <SkipBack className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" onClick={() => onSkip(1)} disabled={!canPlay}
            aria-label="Next sentence" className="rounded-full">
            <SkipForward className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" onClick={onStop} disabled={!canStop}
            aria-label="Stop"
            className="rounded-full hover:border-destructive/30 hover:bg-destructive/10 hover:text-destructive">
            <Square className="h-4 w-4" />
          </Button>
        </div>

        <div
          className="relative mx-1 h-2 flex-1 overflow-hidden rounded-full bg-muted/60"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(progress * 100)}
        >
          <div
            className="relative h-full rounded-full bg-gradient-to-r from-echo via-lilac to-echo
                       transition-[width] duration-200 ease-linear"
            style={{ width: `${progress * 100}%` }}
          >
            {isPlaying && (
              <span className="absolute inset-0 overflow-hidden rounded-full">
                <span className="absolute inset-0 animate-shimmer bg-gradient-to-r from-transparent via-white/40 to-transparent" />
              </span>
            )}
          </div>
        </div>

        <span className="hidden whitespace-nowrap text-xs tabular-nums text-muted-foreground sm:inline">
          {isIdle
            ? `${wordCount.toLocaleString()} words · ~${formatDuration(estimatedSeconds)}`
            : `${Math.min(currentIndex + 1, sentenceCount)} / ${sentenceCount} sentences`}
        </span>
      </div>

      {status === 'buffering' && <p role="status" className="text-center text-xs text-muted-foreground">Rendering PHAROS’s voice on this Mac…</p>}

      {/* One scrolling row on a phone: wrapping pushed the reading pane
          down to almost nothing on a 320px screen. */}
      <div className="flex items-center gap-1 overflow-x-auto pb-0.5
                      [scrollbar-width:none] [&::-webkit-scrollbar]:hidden
                      sm:flex-wrap sm:overflow-visible">
        <Button variant="ghost" size="sm" onClick={onSample}
          className="shrink-0 gap-1.5 text-muted-foreground hover:bg-lilac/10 hover:text-lilac">
          <Sparkles className="h-3.5 w-3.5" /> Sample
        </Button>
        <Button variant="ghost" size="sm" onClick={onImport} disabled={importing}
          className="shrink-0 gap-1.5 text-muted-foreground hover:bg-echo/10 hover:text-echo">
          {importing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />} Import
        </Button>
        <Button variant="ghost" size="sm" onClick={onFetchUrl} disabled={importing}
          className="shrink-0 gap-1.5 text-muted-foreground hover:bg-echo/10 hover:text-echo">
          <Globe className="h-3.5 w-3.5" /> URL
        </Button>
        <Button variant="ghost" size="sm" onClick={onSave} disabled={!wordCount}
          className="shrink-0 gap-1.5 text-muted-foreground hover:bg-echo/10 hover:text-echo">
          <BookmarkPlus className="h-3.5 w-3.5" /> Save draft
        </Button>

        <span className="mx-1 hidden h-4 w-px shrink-0 bg-border sm:block" />

        <Button
          variant="ghost"
          size="sm"
          onClick={onToggleDecipher}
          disabled={!decipherAvailable}
          aria-pressed={decipher && decipherAvailable}
          title={decipherAvailable
            ? 'Read amounts, dates and serial numbers as words'
            : 'Deciphering is available for English and French'}
          className={`shrink-0 gap-1.5 transition-colors ${
            decipher && decipherAvailable
              ? 'bg-lilac/10 text-lilac hover:bg-lilac/15'
              : 'text-muted-foreground hover:bg-lilac/10 hover:text-lilac'
          }`}
        >
          <Hash className="h-3.5 w-3.5" />
          Decipher numbers
          <span className={`ml-0.5 rounded-full px-1.5 py-px text-[0.6rem] font-semibold uppercase ${
            decipher && decipherAvailable ? 'bg-lilac/20' : 'bg-muted'
          }`}
          >
            {decipherAvailable ? (decipher ? 'on' : 'off') : 'n/a'}
          </span>
        </Button>
      </div>
    </div>
  );
}
