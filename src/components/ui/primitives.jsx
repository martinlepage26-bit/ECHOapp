import { useEffect, useId, useLayoutEffect, useRef, useState, createContext, useContext, useCallback } from 'react';
import { createPortal } from 'react-dom';

export const cx = (...parts) => parts.filter(Boolean).join(' ');

/* ── Button ──────────────────────────────────────────────────────────── */

const VARIANTS = {
  default: 'bg-primary text-primary-foreground hover:bg-primary/90',
  outline: 'border border-border bg-background hover:bg-accent hover:text-accent-foreground',
  ghost: 'hover:bg-accent hover:text-accent-foreground',
  destructive: 'bg-destructive text-destructive-foreground hover:bg-destructive/90',
  bare: '',
};
const SIZES = {
  default: 'h-9 px-4 py-2 text-sm',
  sm: 'h-8 px-3 text-xs',
  icon: 'h-9 w-9',
  none: '',
};

export function Button({ variant = 'default', size = 'default', className, type = 'button', ...props }) {
  return (
    <button
      type={type}
      className={cx(
        'inline-flex items-center justify-center gap-2 rounded-md font-medium',
        'ring-offset-background transition-colors focus-visible:outline-none',
        'focus-visible:ring-2 focus-visible:ring-lilac/60 focus-visible:ring-offset-2',
        'disabled:pointer-events-none disabled:opacity-50',
        VARIANTS[variant], SIZES[size], className,
      )}
      {...props}
    />
  );
}

/* ── Input ───────────────────────────────────────────────────────────── */

export function Input({ className, ...props }) {
  return (
    <input
      className={cx(
        'flex h-9 w-full rounded-md border border-border bg-background px-3 py-1 text-sm',
        'placeholder:text-muted-foreground focus-visible:outline-none',
        'focus-visible:ring-2 focus-visible:ring-lilac/50', className,
      )}
      {...props}
    />
  );
}

/* ── Popover menu ────────────────────────────────────────────────────── */
/* A lightweight dropdown: portalled, click-outside and Escape to dismiss,
   and repositioned on scroll so it never detaches from its trigger. */

export function Menu({ trigger, children, align = 'start', width = 288 }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const triggerRef = useRef(null);
  const menuRef = useRef(null);

  const place = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const margin = 8;
    const menuW = Math.min(width, window.innerWidth - margin * 2);
    // The menu is already in the DOM by the time the layout effect runs, so
    // its real height is measurable — clamping against a fixed guess let a
    // long voice list hang off the bottom of a short window.
    const menuH = menuRef.current?.offsetHeight ?? 0;
    const below = r.bottom + 6;
    const above = r.top - 6 - menuH;

    let top = below;
    if (menuH && below + menuH > window.innerHeight - margin) {
      top = above >= margin ? above : Math.max(margin, window.innerHeight - margin - menuH);
    }
    const left = align === 'end' ? r.right - menuW : r.left;
    setPos({
      top,
      left: Math.max(margin, Math.min(left, window.innerWidth - menuW - margin)),
    });
  }, [align, width]);

  useLayoutEffect(() => { if (open) place(); }, [open, place]);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (menuRef.current?.contains(e.target) || triggerRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, place]);

  return (
    <>
      <span ref={triggerRef} onClick={() => setOpen((v) => !v)}>
        {typeof trigger === 'function' ? trigger(open) : trigger}
      </span>
      {open && createPortal(
        <div
          ref={menuRef}
          role="menu"
          style={{ top: pos.top, left: pos.left, width, maxWidth: 'calc(100vw - 16px)' }}
          className="fixed z-50 max-h-[min(60vh,26rem)] overflow-y-auto rounded-xl border border-border
                     bg-popover/95 backdrop-blur-xl p-1.5 shadow-2xl shadow-black/10
                     animate-in origin-top"
          onClick={(e) => {
            if (e.target.closest('[data-menu-item]')) setOpen(false);
          }}
        >
          {children}
        </div>,
        document.body,
      )}
    </>
  );
}

export function MenuItem({ className, active, ...props }) {
  return (
    <button
      type="button"
      data-menu-item=""
      role="menuitem"
      className={cx(
        'flex w-full items-start gap-2 rounded-lg px-2.5 py-2 text-left text-sm',
        'transition-colors hover:bg-lilac/10 focus:bg-lilac/10 focus:outline-none',
        active && 'bg-lilac/10', className,
      )}
      {...props}
    />
  );
}

export function MenuLabel({ children }) {
  return (
    <div className="px-2.5 pt-2.5 pb-1 text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground">
      {children}
    </div>
  );
}

export const MenuSeparator = () => <div className="my-1 h-px bg-border" />;

/* ── Slider ──────────────────────────────────────────────────────────── */

export function Slider({ value, onChange, min = 0, max = 1, step = 0.1, className, ...props }) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <input
      type="range"
      value={value}
      min={min}
      max={max}
      step={step}
      onChange={(e) => onChange(Number(e.target.value))}
      className={cx('echo-slider', className)}
      style={{ '--fill': `${pct}%` }}
      {...props}
    />
  );
}

/* ── Focus management for modal surfaces ─────────────────────────────── */

const FOCUSABLE = [
  'a[href]', 'button:not([disabled])', 'input:not([disabled])',
  'select:not([disabled])', 'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

/**
 * Move focus into a surface that claims `aria-modal`, keep Tab inside it, and
 * hand focus back to whatever opened it. Without this a keyboard or screen
 * reader user tabs straight out of the dialog into the page behind it.
 */
function useFocusTrap(active) {
  const ref = useRef(null);

  useEffect(() => {
    const root = ref.current;
    if (!active || !root) return undefined;
    const opener = document.activeElement;

    // getClientRects beats offsetParent here: the panel sits inside a fixed
    // overlay, where offsetParent is null even for visible children.
    const focusable = () =>
      [...root.querySelectorAll(FOCUSABLE)].filter((el) => el.getClientRects().length > 0);

    const first = focusable()[0];
    (first || root).focus();

    const onKey = (e) => {
      if (e.key !== 'Tab') return;
      const items = focusable();
      if (items.length === 0) { e.preventDefault(); return; }
      const head = items[0];
      const tail = items[items.length - 1];
      if (e.shiftKey && document.activeElement === head) { e.preventDefault(); tail.focus(); }
      else if (!e.shiftKey && document.activeElement === tail) { e.preventDefault(); head.focus(); }
    };

    root.addEventListener('keydown', onKey);
    return () => {
      root.removeEventListener('keydown', onKey);
      if (opener instanceof HTMLElement && document.contains(opener)) opener.focus();
    };
  }, [active]);

  return ref;
}

/* ── Sheet (slide-over panel) ────────────────────────────────────────── */

export function Sheet({ open, onOpenChange, title, description, children }) {
  const panelRef = useFocusTrap(open);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onOpenChange(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onOpenChange]);

  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex justify-end">
      <div
        className="absolute inset-0 bg-black/30 backdrop-blur-sm animate-fade-in"
        onClick={() => onOpenChange(false)}
      />
      <aside
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="relative flex h-full w-full max-w-md flex-col gap-4 border-l border-border
                   bg-background p-6 shadow-2xl animate-slide-in"
      >
        <header className="flex items-start justify-between gap-3">
          <div>
            <h2 className="font-heading text-lg font-semibold">{title}</h2>
            {description && <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>}
          </div>
          <Button variant="ghost" size="icon" aria-label={`Close ${title}`} onClick={() => onOpenChange(false)} className="shrink-0">
            <span aria-hidden="true">×</span>
          </Button>
        </header>
        {children}
      </aside>
    </div>,
    document.body,
  );
}

/* ── Toasts ──────────────────────────────────────────────────────────── */

const ToastContext = createContext({ toast: () => {} });

export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);
  const toast = useCallback(({ title, description, variant = 'default', duration = 4200 }) => {
    const id = Math.random().toString(36).slice(2);
    setItems((prev) => [...prev, { id, title, description, variant }]);
    setTimeout(() => setItems((prev) => prev.filter((t) => t.id !== id)), duration);
  }, []);

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-full max-w-sm flex-col gap-2">
        {items.map((t) => (
          <div
            key={t.id}
            role="status"
            className={cx(
              'pointer-events-auto rounded-xl border p-3.5 shadow-lg backdrop-blur-xl animate-slide-up',
              t.variant === 'destructive'
                ? 'border-destructive/30 bg-destructive/10 text-destructive'
                : 'border-border bg-popover/95',
            )}
          >
            <div className="text-sm font-medium">{t.title}</div>
            {t.description && (
              <div className="mt-0.5 text-xs opacity-80 break-words">{t.description}</div>
            )}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);

/* ── Prompt dialog ───────────────────────────────────────────────────── */
/* window.prompt is blocked in some embedding contexts, so ECHO ships its own. */

export function PromptDialog({ open, title, description, placeholder, submitLabel, onSubmit, onCancel }) {
  const [value, setValue] = useState('');
  const inputId = useId();
  const panelRef = useFocusTrap(open);

  useEffect(() => { if (open) setValue(''); }, [open]);
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onCancel(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onCancel]);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm animate-fade-in" onClick={onCancel} />
      <form
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        onSubmit={(e) => { e.preventDefault(); if (value.trim()) onSubmit(value.trim()); }}
        className="relative w-full max-w-md rounded-2xl border border-border bg-background p-6 shadow-2xl animate-slide-up"
      >
        <label htmlFor={inputId} className="font-heading text-lg font-semibold">{title}</label>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
        <Input
          id={inputId}
          autoFocus
          value={value}
          placeholder={placeholder}
          onChange={(e) => setValue(e.target.value)}
          className="mt-4"
        />
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onCancel}>Cancel</Button>
          <Button
            size="sm"
            type="submit"
            disabled={!value.trim()}
            className="bg-gradient-to-r from-echo to-lilac text-white hover:opacity-90"
          >
            {submitLabel || 'Go'}
          </Button>
        </div>
      </form>
    </div>,
    document.body,
  );
}
