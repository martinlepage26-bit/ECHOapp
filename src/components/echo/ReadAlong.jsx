import { memo, useEffect, useRef } from 'react';

/**
 * ReadAlong — the reading surface.
 *
 * The sentence is the unit of highlight. Word-level highlighting depended on
 * `onboundary` char offsets, which browsers report inconsistently and which
 * drift the moment the spoken text differs from the written text — and with
 * amounts and serial numbers deciphered, it always does. A sentence is a unit
 * every engine agrees on, and it is what the eye tracks anyway.
 */

const Sentence = memo(function Sentence({ text, state, onSeek, index }) {
  return (
    <span
      role="button"
      tabIndex={0}
      data-active={state === 'active' || undefined}
      onClick={() => onSeek(index)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSeek(index); }
      }}
      className={
        state === 'active'
          ? 'echo-sentence echo-sentence-active'
          : state === 'past'
            ? 'echo-sentence echo-sentence-past'
            : 'echo-sentence'
      }
    >
      {text}
    </span>
  );
});

function ReadAlong({ sentences, currentIndex, onSeek, follow = true }) {
  const containerRef = useRef(null);
  const lastScrolled = useRef(-1);

  useEffect(() => {
    if (!follow || currentIndex < 0 || currentIndex === lastScrolled.current) return;
    lastScrolled.current = currentIndex;
    const container = containerRef.current;
    const el = container?.querySelector('[data-active]');
    if (!container || !el) return;

    const top = el.getBoundingClientRect().top - container.getBoundingClientRect().top;
    // Keep the live sentence in the upper third, and only move when it drifts
    // out of a comfortable band — constant scrolling is harder to read than none.
    if (top > container.clientHeight * 0.62 || top < container.clientHeight * 0.08) {
      // scroll-behavior in CSS does not govern this call, so the reduced-motion
      // preference has to be read here as well.
      const calm = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      container.scrollTo({
        top: container.scrollTop + top - container.clientHeight * 0.3,
        behavior: calm ? 'auto' : 'smooth',
      });
    }
  }, [currentIndex, follow]);

  return (
    <div ref={containerRef} className="h-full overflow-y-auto px-5 py-10 md:px-8 md:py-14">
      <div className="mx-auto max-w-3xl font-body text-xl leading-loose md:text-[1.6rem] md:leading-[1.75]">
        {sentences.map((s, i) => (
          <span key={`${s.start}-${i}`}>
            {s.paraBreak > 0 && <span className="block h-6 md:h-9" aria-hidden="true" />}
            <Sentence
              index={i}
              text={s.text}
              onSeek={onSeek}
              state={i === currentIndex ? 'active' : i < currentIndex ? 'past' : 'ahead'}
            />
            {' '}
          </span>
        ))}
      </div>
      <div className="h-[35vh]" aria-hidden="true" />
    </div>
  );
}

export default memo(ReadAlong);
