/**
 * PharosWatermark — the Pharos lighthouse mark recolored to ECHO's
 * teal-to-lilac palette. Sits fixed in the bottom-left corner.
 */
export default function PharosWatermark() {
  return (
    <a
      href="https://pharos-ai.ca"
      target="_blank"
      rel="noopener noreferrer"
      aria-label="PHAROS — Research & Practice in AI Accountability"
      className="fixed bottom-4 left-4 z-20 group hidden items-end gap-2 opacity-40 transition-opacity duration-300 hover:opacity-90 sm:flex"
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 160 120"
        role="img"
        aria-hidden="true"
        className="w-10 h-auto drop-shadow-sm group-hover:drop-shadow-md transition-all duration-300"
      >
        <defs>
          {/* Beam: echo teal → transparent */}
          <linearGradient id="pw-beam" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0"    stopColor="#21c8aa" stopOpacity="0.85" />
            <stop offset="0.42" stopColor="#6ee7d4" stopOpacity="0.38" />
            <stop offset="1"    stopColor="#6ee7d4" stopOpacity="0"    />
          </linearGradient>
          {/* Tower: dark teal → mid teal → lilac highlight */}
          <linearGradient id="pw-tower" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0"    stopColor="#0d6b5e" />
            <stop offset="0.52" stopColor="#1a9e87" />
            <stop offset="0.82" stopColor="#7c5fb8" />
            <stop offset="1"    stopColor="#0d6b5e" />
          </linearGradient>
          {/* Stone base: deep teal → lilac */}
          <linearGradient id="pw-stone" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0"    stopColor="#0d5c50" />
            <stop offset="0.58" stopColor="#1a9e87" />
            <stop offset="1"    stopColor="#9b7fd4" />
          </linearGradient>
          {/* Lantern: lilac glow */}
          <linearGradient id="pw-lantern" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0"    stopColor="#e0d4ff" />
            <stop offset="0.55" stopColor="#a78bfa" />
            <stop offset="1"    stopColor="#7c3aed" />
          </linearGradient>
          <filter id="pw-glow" x="-80%" y="-100%" width="260%" height="300%">
            <feGaussianBlur stdDeviation="3.1" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Light beam */}
        <path d="M58 31 L158 19 L158 53 Z" fill="url(#pw-beam)" />

        {/* Water / wave */}
        <path d="M18 102 C34 92 48 94 61 96 C78 99 90 103 106 102 C121 101 133 95 145 91 C132 103 119 111 100 113 C76 116 51 113 18 102 Z" fill="#064e42" opacity="0.96" />
        <path d="M15 103 C34 105 50 109 69 109 C89 109 107 104 124 97 C115 106 103 113 86 116 C62 119 39 114 15 103 Z" fill="#21c8aa" opacity="0.55" />
        <path d="M23 100 C41 98 54 99 69 103 C83 107 95 106 110 102" fill="none" stroke="#6ee7d4" strokeWidth="2.4" strokeLinecap="round" opacity="0.7" />

        {/* Stone base */}
        <path d="M47 88 L40 101 L76 103 L84 91 L66 84 Z" fill="url(#pw-stone)" stroke="#064038" strokeWidth="2" strokeLinejoin="round" />
        <path d="M49 89 L62 84 L78 92 L67 94 Z" fill="#6ee7d4" opacity="0.5" />

        {/* Tower body */}
        <path d="M48 86 L51 43 L67 43 L72 87 Z" fill="url(#pw-tower)" stroke="#042e26" strokeWidth="2.3" strokeLinejoin="round" />
        <path d="M53 47 L57 47 L56 82 L52 85 Z" fill="#6ee7d4" opacity="0.7" />
        <path d="M65 46 L68 85" fill="none" stroke="#c4b5fd" strokeWidth="1.4" opacity="0.55" />

        {/* Balcony rings */}
        <path d="M45 43 L73 43 L70 49 L48 49 Z" fill="#0d5c50" stroke="#042e26" strokeWidth="1.8" />
        <path d="M47 38 L71 38 L69 44 L49 44 Z" fill="#1a9e87" stroke="#042e26" strokeWidth="1.8" />

        {/* Lantern room with lilac glow */}
        <g filter="url(#pw-glow)">
          <rect x="49" y="27" width="20" height="12" rx="1.5" fill="url(#pw-lantern)" stroke="#042e26" strokeWidth="1.8" />
        </g>
        <path d="M53 28 V38 M59 28 V38 M65 28 V38" stroke="#4c1d95" strokeWidth="1" opacity="0.6" />

        {/* Roof cap */}
        <path d="M46 27 L72 27 L69 23 L59 18 L49 23 Z" fill="#1a9e87" stroke="#042e26" strokeWidth="1.9" strokeLinejoin="round" />
        <path d="M59 18 V14" stroke="#042e26" strokeWidth="1.8" strokeLinecap="round" />
        <path d="M45 39 H73" stroke="#042e26" strokeWidth="2" strokeLinecap="round" />
      </svg>

      <span className="text-[10px] font-mono tracking-widest uppercase leading-none mb-1 text-muted-foreground group-hover:text-echo transition-colors duration-300">
        PHAROS
      </span>
    </a>
  );
}
