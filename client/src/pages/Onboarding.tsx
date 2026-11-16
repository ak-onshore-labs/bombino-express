import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ComponentType, type ReactElement, type ReactNode, type TouchEvent as ReactTouchEvent } from 'react';
import { useLocation } from 'wouter';
import { AnimatePresence, MotionConfig, motion, type Variants } from 'framer-motion';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { useAppStore } from '@/lib/store';
import { cn } from '@/lib/utils';
import bombinoLogo from '@/assets/bombino-logo.png';
import { EarnVisual, ShipVisual, TrackVisual } from '@/components/onboarding/OnboardingVisuals';

interface Slide {
  id: string;
  kicker: string;
  title: string;
  body: string;
  Visual: ComponentType;
}

/* Three screens, no more. Copy follows what the app does today (see
   content/bia/app-guide.md): any destination from India, pickup or counter
   drop-off, Sending and Receiving, WhatsApp updates for both ends, BIA, and
   reward points for account holders. */
const slides: Slide[] = [
  {
    id: 'ship',
    kicker: 'Ship',
    title: 'Ship from India to anywhere',
    body: 'Book in minutes. We pick up from your door, or you drop it at a Bombino counter. See the price before you pay.',
    Visual: ShipVisual,
  },
  {
    id: 'track',
    kicker: 'Track',
    title: 'Track it, or just ask BIA',
    body: "Follow what you send and what's coming to you, with WhatsApp updates for both ends. BIA answers any time.",
    Visual: TrackVisual,
  },
  {
    id: 'earn',
    kicker: 'Earn',
    title: 'Points on every delivery',
    body: "With a Bombino account, every ₹100 you're billed earns 1 point. From 100 points, each one is ₹1 off a booking.",
    Visual: EarnVisual,
  },
];

const SWIPE_PX = 50;
const VISUAL_WIDTH = 300;

/**
 * The illustration's frame: faint graph paper, with the illustration scaled
 * to fit whatever height is left. A 360×640 phone has roughly half the stage
 * of an iPhone 14, so a fixed-size drawing either clips on the small one or
 * floats in empty space on the big one. offsetWidth/Height ignore transforms,
 * so measuring the scaled element stays stable.
 */
function FitStage({ children }: { children: ReactNode }): ReactElement {
  const outer = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  useLayoutEffect(() => {
    const o = outer.current;
    const i = inner.current;
    if (!o || !i) return;
    const fit = (): void => {
      const room = 40; // breathing space around the drawing, both axes
      const s = Math.min(1.15, (o.clientHeight - room) / i.offsetHeight, (o.clientWidth - room) / i.offsetWidth);
      setScale(Math.max(0.5, Number.isFinite(s) ? s : 1));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(o);
    ro.observe(i);
    return () => ro.disconnect();
  }, []);

  return (
    <div
      ref={outer}
      className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden border border-border bg-background"
      style={{
        borderRadius: 'var(--doc-radius)',
        backgroundImage:
          'linear-gradient(rgb(var(--border) / 0.55) 1px, transparent 1px), linear-gradient(90deg, rgb(var(--border) / 0.55) 1px, transparent 1px)',
        backgroundSize: '22px 22px',
        backgroundPosition: 'center',
      }}
    >
      <div ref={inner} className="flex shrink-0 justify-center" style={{ width: VISUAL_WIDTH, transform: `scale(${scale})` }}>
        {children}
      </div>
    </div>
  );
}

/* Transitions. The illustration slides in from the side being swiped
   towards, with a slight scale-up; it leaves the other way, faster than it
   came. The copy follows a beat later, line by line. */
const EASE_OUT = [0.22, 1, 0.36, 1] as const;

const visualVariants: Variants = {
  enter: (dir: number) => ({ opacity: 0, x: dir * 64, scale: 0.94 }),
  center: { opacity: 1, x: 0, scale: 1, transition: { duration: 0.42, ease: EASE_OUT } },
  exit: (dir: number) => ({ opacity: 0, x: dir * -64, scale: 0.97, transition: { duration: 0.2, ease: 'easeIn' } }),
};

const copyVariants: Variants = {
  enter: { opacity: 1 },
  center: { opacity: 1, transition: { delayChildren: 0.12, staggerChildren: 0.07 } },
  exit: (dir: number) => ({ opacity: 0, x: dir * -24, transition: { duration: 0.18, ease: 'easeIn' } }),
};

const lineVariants: Variants = {
  enter: { opacity: 0, y: 14 },
  center: { opacity: 1, y: 0, transition: { duration: 0.36, ease: EASE_OUT } },
};

export default function Onboarding(): ReactElement {
  const [index, setIndex] = useState(0);
  const [direction, setDirection] = useState<1 | -1>(1);
  const [, setLocation] = useLocation();
  const { setHasSeenOnboarding } = useAppStore();
  const touchX = useRef<number | null>(null);

  const isFirst = index === 0;
  const isLast = index === slides.length - 1;
  const slide = slides[index];
  const Visual = slide.Visual;

  const goTo = useCallback(
    (next: number) => {
      if (next < 0 || next >= slides.length || next === index) return;
      setDirection(next > index ? 1 : -1);
      setIndex(next);
    },
    [index],
  );

  const finish = useCallback(
    (to: '/home' | '/login') => {
      setHasSeenOnboarding(true);
      setLocation(to);
    },
    [setHasSeenOnboarding, setLocation],
  );

  const handleNext = (): void => {
    if (isLast) finish('/home');
    else goTo(index + 1);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'ArrowRight') goTo(index + 1);
      if (e.key === 'ArrowLeft') goTo(index - 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [goTo, index]);

  const onTouchStart = (e: ReactTouchEvent): void => {
    touchX.current = e.touches[0]?.clientX ?? null;
  };
  const onTouchEnd = (e: ReactTouchEvent): void => {
    if (touchX.current === null) return;
    const dx = (e.changedTouches[0]?.clientX ?? touchX.current) - touchX.current;
    touchX.current = null;
    if (dx <= -SWIPE_PX) goTo(index + 1);
    if (dx >= SWIPE_PX) goTo(index - 1);
  };

  return (
    // reducedMotion="user": with the OS setting on, framer drops every
    // transform (slides, stagger, the visuals' own entrances) and keeps fades.
    <MotionConfig reducedMotion="user">
    <div
      className="fixed inset-0 flex flex-col bg-card safe-top safe-bottom overscroll-none"
      data-testid="screen-onboarding"
    >
      {/* Top bar: wordmark and Skip. Skip stays in the layout on the last
          slide (invisible) so nothing shifts. */}
      <header className="flex items-center justify-between px-5 pt-3">
        <img src={bombinoLogo} alt="Bombino Express" className="h-auto w-[116px] object-contain" />
        <button
          type="button"
          onClick={() => finish('/home')}
          className={cn('doc-link tap-target focus-ring -mr-2 px-2', isLast && 'invisible')}
          aria-hidden={isLast}
          tabIndex={isLast ? -1 : 0}
          data-testid="button-skip"
        >
          Skip
        </button>
      </header>

      <main
        className="flex min-h-0 flex-1 flex-col"
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
        aria-roledescription="carousel"
        aria-label="What you can do with Bombino Express"
      >
        {/* Stage: the graph-paper frame stays put; only the illustration
            inside it moves, so the screen feels like one surface. */}
        <div className="flex min-h-0 flex-1 px-5 pt-4">
          <FitStage>
            <AnimatePresence mode="wait" custom={direction}>
              <motion.div
                key={slide.id}
                custom={direction}
                variants={visualVariants}
                initial="enter"
                animate="center"
                exit="exit"
                className="flex w-full justify-center"
                data-testid={`slide-${slide.id}`}
              >
                <Visual />
              </motion.div>
            </AnimatePresence>
          </FitStage>
        </div>

        {/* Copy. The min-height holds two title lines and three body lines,
            so the stage above keeps its size from slide to slide. The three
            lines come in one after another, just behind the illustration. */}
        <div className="min-h-[10.75rem] px-6 pt-6">
          <AnimatePresence mode="wait" custom={direction}>
            <motion.div
              key={slide.id}
              custom={direction}
              variants={copyVariants}
              initial="enter"
              animate="center"
              exit="exit"
              aria-roledescription="slide"
              aria-label={`${index + 1} of ${slides.length}`}
            >
              <motion.p variants={lineVariants} className="doc-label" data-testid="text-onboarding-kicker">
                <span className="text-accent">{String(index + 1).padStart(2, '0')}</span>
                <span className="mx-1.5 text-border">/</span>
                {slide.kicker}
              </motion.p>
              <motion.h1
                variants={lineVariants}
                className="mt-2 text-[26px] font-bold leading-[1.15] tracking-[-0.01em] text-foreground"
              >
                {slide.title}
              </motion.h1>
              <motion.p
                variants={lineVariants}
                className="mt-2.5 max-w-[34ch] text-[15px] leading-relaxed text-muted-foreground"
              >
                {slide.body}
              </motion.p>
            </motion.div>
          </AnimatePresence>
        </div>
      </main>

      <footer className="px-6 pb-5 pt-5">
        {/* Progress: one segment per slide, filled up to the current one.
            Each segment is a 44px-tall button around a 4px bar. */}
        <div className="-my-5 flex gap-1.5" role="group" aria-label="Choose a slide">
          {slides.map((s, i) => (
            <button
              key={s.id}
              type="button"
              onClick={() => goTo(i)}
              className="focus-ring flex h-11 flex-1 items-center"
              aria-label={`Slide ${i + 1}: ${s.kicker}`}
              aria-current={i === index ? 'step' : undefined}
              data-testid={`dot-${i}`}
            >
              <span
                className={cn(
                  'h-1 w-full rounded-full transition-colors duration-200',
                  i <= index ? 'bg-accent' : 'bg-border',
                )}
              />
            </button>
          ))}
        </div>

        <div className="mt-6 flex gap-2.5">
          {!isFirst && (
            <button
              type="button"
              onClick={() => goTo(index - 1)}
              className="doc-btn-quiet focus-ring flex h-12 w-12 shrink-0 items-center justify-center"
              aria-label="Previous"
              data-testid="button-back"
            >
              <ArrowLeft className="h-5 w-5" />
            </button>
          )}
          <button
            type="button"
            onClick={handleNext}
            className="doc-btn-cta focus-ring flex h-12 flex-1 items-center justify-center gap-2 text-base active:scale-[0.99]"
            data-testid="button-next"
          >
            {isLast ? 'Get started' : 'Next'}
            <ArrowRight className="h-5 w-5" />
          </button>
        </div>

        <p className="mt-3 text-center text-sm text-muted-foreground">
          Already with us?{' '}
          <button
            type="button"
            onClick={() => finish('/login')}
            className="focus-ring tap-target -my-3 font-semibold text-foreground underline-offset-4 hover:underline"
            data-testid="button-onboarding-login"
          >
            Sign in
          </button>
        </p>
      </footer>
    </div>
    </MotionConfig>
  );
}
