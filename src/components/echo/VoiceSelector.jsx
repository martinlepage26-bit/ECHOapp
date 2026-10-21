import { Check, ChevronDown, Volume2, RefreshCw } from 'lucide-react';
import { Button, Menu, MenuItem, MenuLabel, MenuSeparator } from '@/components/ui/primitives';

/** Echo speaks with exactly two voices, both rendered by F5-TTS through the Worker. */
export default function VoiceSelector({ voices, selectedVoiceId, selectedVoice, onSelect, voiceStatus, onRetry }) {
  const unavailable = voiceStatus === 'unavailable';
  return (
    <Menu
      width={260}
      trigger={(open) => (
        <Button
          variant="outline"
          size="none"
          aria-expanded={open}
          aria-label="Voice"
          className="h-auto min-w-[170px] justify-start gap-2 px-3 py-1.5 hover:border-lilac/40 hover:bg-lilac/5"
        >
          <Volume2 className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="flex flex-col items-start text-left">
            <span className="text-sm font-medium leading-tight">{selectedVoice?.name}</span>
            <span className={`text-xs leading-tight ${unavailable ? 'text-destructive' : 'text-muted-foreground'}`}>
              {voiceStatus === 'ready' ? 'Echo voice · ready' : unavailable ? 'Echo voice unavailable' : 'Checking voice…'}
            </span>
          </span>
          <ChevronDown className="ml-auto h-4 w-4 shrink-0 opacity-50" />
        </Button>
      )}
    >
      <MenuLabel>Voice · Voix</MenuLabel>
      {voices.map((v) => (
        <MenuItem key={v.id} active={v.id === selectedVoiceId} onClick={() => onSelect(v.id)}>
          <Volume2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate font-medium">{v.name}</span>
            <span className="truncate text-xs text-muted-foreground">{v.description}</span>
          </span>
          {v.id === selectedVoiceId && <Check className="mt-0.5 h-4 w-4 shrink-0 text-lilac" />}
        </MenuItem>
      ))}
      {unavailable && (
        <>
          <MenuSeparator />
          <div className="px-2 py-2">
            <Button variant="outline" size="sm" className="w-full gap-2" onClick={onRetry}>
              <RefreshCw className="h-3.5 w-3.5" /> Retry voice
            </Button>
          </div>
        </>
      )}
    </Menu>
  );
}
