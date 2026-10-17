import { useMemo, useState } from 'react';
import { Check, ChevronDown, Volume2, Search, HardDrive } from 'lucide-react';
import { Button, Menu, MenuItem, MenuLabel, MenuSeparator, Input } from '@/components/ui/primitives';
import { languageName } from '@/lib/language';

/** Group voices by language so a long system list stays navigable. */
function group(voices) {
  const byLang = new Map();
  for (const v of voices) {
    const code = (v.lang || '').split(/[-_]/)[0].toLowerCase() || 'other';
    if (!byLang.has(code)) byLang.set(code, []);
    byLang.get(code).push(v);
  }
  return byLang;
}

export default function VoiceSelector({ voices, selectedVoiceId, selectedVoice, onSelect, preferredLang, pharosStatus, onConnectPharos }) {
  const [query, setQuery] = useState('');

  const groups = useMemo(() => {
    const filtered = query.trim()
      ? voices.filter((v) => `${v.name} ${v.lang}`.toLowerCase().includes(query.trim().toLowerCase()))
      : voices;
    const byLang = group(filtered);
    // The document's own language comes first; the rest follow alphabetically.
    return [...byLang.entries()].sort(([a], [b]) => {
      if (a === preferredLang) return -1;
      if (b === preferredLang) return 1;
      return languageName(a).localeCompare(languageName(b));
    });
  }, [voices, query, preferredLang]);

  return (
    <Menu
      width={320}
      trigger={(open) => (
        <Button
          variant="outline"
          size="none"
          aria-expanded={open}
          className="h-auto min-w-[190px] justify-start gap-2 px-3 py-1.5 hover:border-lilac/40 hover:bg-lilac/5"
        >
          <Volume2 className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="flex flex-col items-start text-left">
            <span className="text-sm font-medium leading-tight">
              {selectedVoice?.name || 'No voice available'}
            </span>
            <span className="text-xs leading-tight text-muted-foreground">
              {selectedVoice ? `${selectedVoice.lang}${selectedVoice.local ? ' · on device' : ''}` : 'Check browser settings'}
            </span>
          </span>
          <ChevronDown className="ml-auto h-4 w-4 shrink-0 opacity-50" />
        </Button>
      )}
    >
      <div className="px-2 py-2">
        <Button variant="outline" size="sm" className="w-full" onClick={onConnectPharos}
          disabled={pharosStatus === 'connecting'}>
          {pharosStatus === 'connecting' ? 'Connecting…' : pharosStatus === 'ready' ? 'Use PHAROS · Echo' : 'Connect PHAROS on this Mac'}
        </Button>
        <p className="mt-1.5 text-xs text-muted-foreground">PHAROS’s English voice. Text stays on this Mac.</p>
      </div>
      <MenuSeparator />
      {voices.length > 8 && (
        <div className="sticky top-0 z-10 -mx-1.5 -mt-1.5 mb-1 bg-popover/95 px-2.5 pb-2 pt-2.5 backdrop-blur-xl">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              autoFocus
              value={query}
              placeholder="Search voices…"
              onChange={(e) => setQuery(e.target.value)}
              onClick={(e) => e.stopPropagation()}
              className="h-8 pl-8 text-xs"
            />
          </div>
        </div>
      )}

      {groups.length === 0 && (
        <p className="px-3 py-6 text-center text-sm text-muted-foreground">No matching voice.</p>
      )}

      {groups.map(([code, list], gi) => (
        <div key={code}>
          {gi > 0 && <MenuSeparator />}
          <MenuLabel>{languageName(code)} ({list.length})</MenuLabel>
          {list.map((v) => (
            <MenuItem key={v.id} active={v.id === selectedVoiceId} onClick={() => onSelect(v.id)}>
              <Volume2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate font-medium">{v.name}</span>
                <span className="flex items-center gap-1 truncate text-xs text-muted-foreground">
                  {v.lang}
                  {v.local && <><HardDrive className="h-3 w-3" /> on device</>}
                </span>
              </span>
              {v.id === selectedVoiceId && <Check className="mt-0.5 h-4 w-4 shrink-0 text-lilac" />}
            </MenuItem>
          ))}
        </div>
      ))}
    </Menu>
  );
}
