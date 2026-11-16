import { useEffect, useState, type ReactElement, type ReactNode } from 'react';
import { animate, motion, useReducedMotion } from 'framer-motion';
import { Plane, Sparkles } from 'lucide-react';
import whatsAppLogo from '@/assets/WhatsApp.svg.png';
import { cn } from '@/lib/utils';

/**
 * Illustrations for the onboarding slides.
 *
 * Each one is a small piece of the real app drawn in the Freight Document
 * language (hairlines, mono labels, one amber accent), so a first-time
 * customer sees what the screen will look like rather than a generic icon in
 * a circle. Purely decorative: the slide's heading and text carry the
 * meaning, so every visual is aria-hidden and the sample values are made up.
 *
 * Each plays one short entrance as its slide arrives (stamp lands, scans
 * light up, points count up). Onboarding wraps them in
 * <MotionConfig reducedMotion="user">, so with reduced motion on the
 * movement drops out and only the fades remain; the count-up checks for
 * itself.
 */

/* Ease-out with a soft landing; shared so every part settles the same way. */
const EASE_OUT = [0.22, 1, 0.36, 1] as const;

function Sheet({ className, children }: { className?: string; children: ReactNode }): ReactElement {
  return (
    <div
      className={cn('relative w-full border border-border bg-card', className)}
      style={{ borderRadius: 'var(--doc-radius)' }}
    >
      {children}
    </div>
  );
}

function Label({ children, className }: { children: ReactNode; className?: string }): ReactElement {
  return <span className={cn('doc-label text-[10px]', className)}>{children}</span>;
}

/* BIA's mark, drawn in CSS. The live WebGL orb in the chat is too heavy for
   a first screen. */
function BiaDot({ className }: { className?: string }): ReactElement {
  return (
    <span
      className={cn('block shrink-0 rounded-full', className)}
      style={{
        background: 'radial-gradient(circle at 35% 30%, #3E86B0 0%, #14567C 45%, #0B2F47 100%)',
        boxShadow: 'inset 0 0 0 1.5px rgb(var(--accent) / 0.55), 0 0 12px rgb(var(--accent) / 0.25)',
      }}
    />
  );
}

/* 01 · Ship — a booking docket; the plane crosses the route and the pickup
   stamp lands on it. */
export function ShipVisual(): ReactElement {
  return (
    <div className="relative w-full max-w-[300px]" aria-hidden="true">
      {/* A second sheet under the first: the docket reads as paper. */}
      <motion.div
        className="absolute inset-x-3 -bottom-2 top-2 border border-border bg-card"
        style={{ borderRadius: 'var(--doc-radius)' }}
        initial={{ opacity: 0, y: -6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.25, duration: 0.3, ease: EASE_OUT }}
      />
      <Sheet className="p-4">
        <div className="flex items-center justify-between">
          <Label>Order</Label>
          <span className="doc-mono text-xs font-semibold text-foreground">BOM-24817</span>
        </div>
        <motion.div
          className="doc-rule-heavy mt-3 origin-left"
          initial={{ scaleX: 0 }}
          animate={{ scaleX: 1 }}
          transition={{ delay: 0.15, duration: 0.45, ease: EASE_OUT }}
        />

        <div className="mt-4 flex items-start justify-between gap-2">
          <div className="min-w-0">
            <Label>From</Label>
            <p className="mt-1 text-lg font-bold leading-none text-foreground">Mumbai</p>
            <p className="doc-mono mt-1 text-[11px] text-muted-foreground">IN 400001</p>
          </div>
          <div className="relative mt-5 flex flex-1 items-center px-1">
            <span className="h-px flex-1 border-t border-dashed border-muted-foreground/50" />
            <motion.span
              className="absolute left-1/2 top-1/2 -ml-2 -mt-2 bg-card"
              initial={{ x: -34, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              transition={{ delay: 0.3, duration: 0.6, ease: EASE_OUT }}
            >
              <Plane className="h-4 w-4 text-accent" />
            </motion.span>
          </div>
          <div className="min-w-0 text-right">
            <Label>To</Label>
            <p className="mt-1 text-lg font-bold leading-none text-foreground">New York</p>
            <p className="doc-mono mt-1 text-[11px] text-muted-foreground">US 10001</p>
          </div>
        </div>

        <div className="doc-rule mt-4" />
        <div className="mt-3 grid grid-cols-3 gap-2">
          <div>
            <Label>Pickup</Label>
            <p className="mt-1 text-sm font-semibold text-foreground">Tomorrow</p>
          </div>
          <div>
            <Label>Weight</Label>
            <p className="doc-mono mt-1 text-sm font-semibold text-foreground">2.5 kg</p>
          </div>
          <div>
            <Label>Pieces</Label>
            <p className="doc-mono mt-1 text-sm font-semibold text-foreground">1</p>
          </div>
        </div>

        {/* The stamp: the one amber mark on the sheet. Lands last. */}
        <motion.span
          className="doc-mono absolute -right-2 -top-3 border-2 border-accent bg-card px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.14em] text-accent"
          style={{ borderRadius: 'calc(var(--doc-radius) - 2px)' }}
          initial={{ opacity: 0, scale: 1.7, rotate: -16 }}
          animate={{ opacity: 1, scale: 1, rotate: -6 }}
          transition={{ delay: 0.7, type: 'spring', stiffness: 420, damping: 18 }}
        >
          Pickup booked
        </motion.span>
      </Sheet>
    </div>
  );
}

/* 02 · Track — Sending/Receiving, the scans lighting up in order, and BIA
   answering "where is it" with the WhatsApp note for both ends. */
const SCANS = [
  { label: 'Picked up', place: 'Mumbai', state: 'done' },
  { label: 'Left the hub', place: 'Mumbai', state: 'done' },
  { label: 'In transit', place: 'New York', state: 'current' },
  { label: 'Delivered', place: '', state: 'next' },
] as const;

const SCAN_START = 0.25;
const SCAN_STEP = 0.14;

export function TrackVisual(): ReactElement {
  return (
    <div className="relative w-full max-w-[300px] pb-20" aria-hidden="true">
      <Sheet className="p-4 pb-5">
        <div className="doc-segment">
          <span
            className="doc-mono flex min-h-8 flex-1 items-center justify-center bg-primary text-[10px] font-semibold uppercase tracking-[0.14em] text-primary-foreground"
            style={{ borderRadius: 'calc(var(--doc-radius) - 1px) 0 0 calc(var(--doc-radius) - 1px)' }}
          >
            Sending
          </span>
          <span
            className="doc-mono flex min-h-8 flex-1 items-center justify-center bg-card text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground"
            style={{ borderRadius: '0 calc(var(--doc-radius) - 1px) calc(var(--doc-radius) - 1px) 0' }}
          >
            Receiving
          </span>
        </div>

        <ol className="mt-4">
          {SCANS.map((scan, i) => {
            const at = SCAN_START + i * SCAN_STEP;
            return (
              <motion.li
                key={scan.label}
                className="relative flex gap-3 pb-3 last:pb-0"
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: at, duration: 0.3, ease: EASE_OUT }}
              >
                {i < SCANS.length - 1 && (
                  <motion.span
                    className={cn(
                      'absolute left-[5px] top-3 h-full w-px origin-top',
                      scan.state === 'done' ? 'bg-foreground/70' : 'bg-border',
                    )}
                    initial={{ scaleY: 0 }}
                    animate={{ scaleY: 1 }}
                    transition={{ delay: at + 0.08, duration: SCAN_STEP, ease: 'linear' }}
                  />
                )}
                <span
                  className={cn(
                    'relative mt-1 h-[11px] w-[11px] shrink-0 rounded-full border-2',
                    scan.state === 'done' && 'border-foreground bg-foreground',
                    scan.state === 'current' && 'border-accent bg-accent',
                    scan.state === 'next' && 'border-border bg-card',
                  )}
                >
                  {/* The current scan keeps a slow pulse: it is the live one. */}
                  {scan.state === 'current' && (
                    <motion.span
                      className="absolute -inset-[5px] rounded-full bg-accent/25"
                      initial={{ scale: 0.6, opacity: 0 }}
                      animate={{ scale: [0.6, 1.25, 0.6], opacity: [0.9, 0, 0.9] }}
                      transition={{ delay: at + 0.2, duration: 1.8, repeat: Infinity, ease: 'easeInOut' }}
                    />
                  )}
                </span>
                <div className="flex min-w-0 flex-1 items-baseline justify-between gap-2">
                  <span
                    className={cn(
                      'text-sm leading-tight',
                      scan.state === 'next' ? 'text-muted-foreground' : 'font-semibold text-foreground',
                    )}
                  >
                    {scan.label}
                  </span>
                  {scan.place && <span className="doc-mono text-[11px] text-muted-foreground">{scan.place}</span>}
                </div>
              </motion.li>
            );
          })}
        </ol>
      </Sheet>

      {/* BIA's answer, rising over the sheet's lower edge once the scans are in. */}
      <motion.div
        className="absolute -right-1 bottom-0 w-[256px] border border-border bg-card p-2.5 shadow-[0_6px_20px_rgb(15_23_42/0.10)]"
        style={{ borderRadius: 'var(--doc-radius)' }}
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: SCAN_START + SCANS.length * SCAN_STEP + 0.1, type: 'spring', stiffness: 300, damping: 24 }}
      >
        <div className="flex items-start gap-2">
          <BiaDot className="mt-0.5 h-5 w-5" />
          <p className="text-[12px] leading-snug text-foreground">
            <span className="font-semibold">BIA:</span> It's on its way to New York.
          </p>
        </div>
        <div className="mt-1.5 flex items-center gap-1.5 border-t border-border pt-1.5">
          <img src={whatsAppLogo} alt="" className="h-3.5 w-3.5 shrink-0" />
          <span className="text-[11px] text-muted-foreground">You and your receiver get updates</span>
        </div>
      </motion.div>
    </div>
  );
}

/* 03 · Earn — the rewards wallet, in the same navy card the Home teaser and
   /rewards use. The balance counts up and the ledger lines drop in. */
const LEDGER = [
  { pts: '+38', what: 'Delivered', ref: 'BOM-24817' },
  { pts: '+12', what: 'Delivered', ref: 'BOM-24790' },
  { pts: '−500', what: 'Used at Review & Pay', ref: '' },
] as const;

const BALANCE = 1240;

function useCountUp(to: number, delay: number, duration: number): number {
  const reduce = useReducedMotion();
  const [value, setValue] = useState(reduce ? to : 0);
  useEffect(() => {
    if (reduce) {
      setValue(to);
      return;
    }
    const controls = animate(0, to, {
      delay,
      duration,
      ease: EASE_OUT,
      onUpdate: (v) => setValue(Math.round(v)),
    });
    return () => controls.stop();
  }, [to, delay, duration, reduce]);
  return value;
}

export function EarnVisual(): ReactElement {
  const balance = useCountUp(BALANCE, 0.2, 0.9);
  const shown = balance.toLocaleString('en-IN');

  return (
    <div className="w-full max-w-[300px]" aria-hidden="true">
      <div
        className="relative overflow-hidden bg-gradient-to-br from-[#2F4468] to-[#16243A] p-4 text-white"
        style={{ borderRadius: 'var(--doc-radius)' }}
      >
        <div className="pointer-events-none absolute -right-10 -top-12 h-36 w-36 rounded-full bg-[#F2A123]/20 blur-2xl" />
        <div className="relative flex items-center justify-between">
          <p className="doc-mono text-[10px] font-bold uppercase tracking-[0.14em] text-[#F7C35C]">Bombino Rewards</p>
          <motion.span
            initial={{ rotate: -30, scale: 0.4, opacity: 0 }}
            animate={{ rotate: 0, scale: 1, opacity: 1 }}
            transition={{ delay: 0.9, type: 'spring', stiffness: 380, damping: 14 }}
          >
            <Sparkles className="h-4 w-4 text-[#F7C35C]" />
          </motion.span>
        </div>
        <p className="relative mt-3 text-[34px] font-bold leading-none tabular-nums">
          {shown} <span className="text-base font-semibold text-white/70">pts</span>
        </p>
        <p className="relative mt-1.5 text-xs tabular-nums text-white/70">₹{shown} off your next booking</p>
      </div>

      <Sheet className="mt-2 px-4 py-1">
        {LEDGER.map((row, i) => (
          <motion.div
            key={row.what + row.ref}
            className="flex items-center gap-3 border-b border-border py-2.5 last:border-b-0"
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.35 + i * 0.12, duration: 0.3, ease: EASE_OUT }}
          >
            <span
              className={cn(
                'doc-mono w-12 shrink-0 text-sm font-bold tabular-nums',
                row.pts.startsWith('+') ? 'text-emerald-700' : 'text-foreground',
              )}
            >
              {row.pts}
            </span>
            <span className="min-w-0 flex-1 truncate text-[13px] text-foreground">{row.what}</span>
            {row.ref && <span className="doc-mono text-[10px] text-muted-foreground">{row.ref}</span>}
          </motion.div>
        ))}
      </Sheet>
    </div>
  );
}
