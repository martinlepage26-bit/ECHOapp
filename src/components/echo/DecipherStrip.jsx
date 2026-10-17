import { motion } from 'framer-motion';
import { Sparkles } from 'lucide-react';

const LABELS = {
  money: 'amount', number: 'number', range: 'range', serial: 'serial',
  date: 'date', time: 'time', phone: 'phone', unit: 'unit', percent: 'percent',
  ordinal: 'ordinal', fraction: 'fraction', version: 'version', ip: 'address',
  url: 'address', year: 'year', scaled: 'number', numsign: 'reference',
  abbrev: 'abbreviation', acronym: 'acronym', symbol: 'symbol', mixed: 'code',
};

/**
 * Shows what ECHO rewrote in the sentence being read, so the reader can see
 * that "$1,234.56" was understood as an amount and not merely mumbled through.
 *
 * Keyed on the sentence rather than wrapped in AnimatePresence: at reading
 * speed a wait-mode exit cannot finish before the next sentence arrives, which
 * left the strip stranded at opacity 0. Re-mounting on the key just fades in.
 */
export default function DecipherStrip({ changes, sentenceKey }) {
  const visible = (changes || []).slice(0, 4);
  if (visible.length === 0) return null;

  // Narrow screens scroll this sideways; wrapping it there would push the
  // transport controls off the bottom of the phone.
  return (
    <motion.div
      key={sentenceKey}
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.16, ease: 'easeOut' }}
      className="flex items-center gap-x-3 gap-y-1.5 overflow-x-auto whitespace-nowrap
                 pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden
                 sm:flex-wrap sm:overflow-visible sm:whitespace-normal"
    >
      <Sparkles className="h-3.5 w-3.5 shrink-0 text-lilac" aria-hidden="true" />
      <span className="sr-only">Read as:</span>
      {visible.map((c) => (
        <span key={`${c.from}-${c.kind}`} className="flex shrink-0 items-center gap-1.5 text-xs">
          <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[0.7rem]">{c.from}</code>
          <span className="text-muted-foreground/60" aria-hidden="true">&rarr;</span>
          <span className="text-muted-foreground">{c.to}</span>
          <span className="rounded-full bg-lilac/10 px-1.5 py-px text-[0.6rem] uppercase tracking-wide text-lilac">
            {LABELS[c.kind] || c.kind}
          </span>
        </span>
      ))}
    </motion.div>
  );
}
