import { motion } from 'framer-motion';

const BARS = [
  { x: 20, h: 24, delay: 0 },
  { x: 32, h: 44, delay: 0.08 },
  { x: 44, h: 60, delay: 0.16 },
  { x: 56, h: 44, delay: 0.24 },
  { x: 68, h: 24, delay: 0.32 },
];

export default function EchoMark({ isPlaying = false, className = '' }) {
  return (
    <motion.div
      className={`relative w-10 h-10 rounded-xl bg-gradient-to-br from-echo to-lilac flex items-center justify-center shadow-lg shadow-lilac/25 shrink-0 ${className}`}
      animate={isPlaying ? { scale: [1, 1.05, 1] } : { scale: 1 }}
      transition={isPlaying ? { duration: 1.4, repeat: Infinity, ease: 'easeInOut' } : { duration: 0.3 }}
    >
      <svg viewBox="0 0 100 100" className="w-6 h-6">
        {BARS.map((b, i) => (
          <motion.rect
            key={i}
            x={b.x}
            y={50 - b.h / 2}
            width="6"
            height={b.h}
            rx="3"
            fill="white"
            opacity={0.45 + i * 0.08}
            style={{ transformBox: 'fill-box', transformOrigin: 'center' }}
            animate={isPlaying ? { scaleY: [1, 1.35, 0.65, 1] } : { scaleY: 1 }}
            transition={
              isPlaying
                ? { duration: 0.7, repeat: Infinity, delay: b.delay, ease: 'easeInOut' }
                : { duration: 0.3 }
            }
          />
        ))}
        <motion.path
          d="M78 35 A19 19 0 0 1 78 65"
          stroke="white"
          strokeWidth="3"
          fill="none"
          strokeLinecap="round"
          style={{ transformBox: 'fill-box', transformOrigin: 'center' }}
          animate={isPlaying ? { opacity: [0.35, 0.7, 0.35], scale: [1, 1.12, 1] } : { opacity: 0.4, scale: 1 }}
          transition={isPlaying ? { duration: 1.4, repeat: Infinity, ease: 'easeInOut' } : { duration: 0.3 }}
        />
      </svg>
    </motion.div>
  );
}