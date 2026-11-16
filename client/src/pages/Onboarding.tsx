import { useCallback, useEffect, useRef, useState, type ComponentType, type ReactElement, type TouchEvent as ReactTouchEvent } from 'react';
import { useLocation } from 'wouter';
import { AnimatePresence, MotionConfig, motion, type Variants } from 'framer-motion';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { useAppStore } from '@/lib/store';
import { cn } from '@/lib/utils';
import bombinoLogo from '@/assets/bombino-logo.png';
import { EarnVisual, ShipVisual, TrackVisual } from '@/components/onboarding/OnboardingVisuals';

interface Slide {
  id: string;
  title: string;
  body: string;
  Visual: ComponentType;
}

/* Three screens, no more, and a few words each: a heading and one short
   line. Many senders are not at ease with apps, so the picture and the
   heading carry the idea and the details wait for the screens themselves.
   Claims stay true to the app today (content/bia/app-guide.md): pickup from
   the door, WhatsApp updates, BIA, and points for account holders. */
const slides: Slide[] = [
  {
    id: 'ship',
    title: 'Send parcels anywhere',
    body: 'From India to the world. We pick up from your door.',
    Visual: ShipVisual,
  },
  {
    id: 'track',
    title: 'Always know where it is',
    body: 'Updates on WhatsApp, and BIA to help any time.',
    Visual: TrackVisual,
  },
  {
    id: 'earn',
    title: 'Earn as you ship',
    body: 'With an account, every delivery earns you points.',
    Visual: EarnVisual,
  },
];

const SWIPE_PX = 50;

/* Transitions. The picture slides in from the side being swiped towards,
   with a slight scale-up, and leaves the other way, faster than it came.
   The heading and line follow a beat later. */
const EASE_OUT = [0.22, 1, 0.36, 1] as const;

const visualVariants: Variants = {
  enter: (dir: number) => ({ opacity: 0, x: dir * 72, scale: 0.92 }),
  center: { opacity: 1, x: 0, scale: 1, transition: { duration: 0.45, ease: EASE_OUT } },
  exit: (dir: number) => ({ opacity: 0, x: dir * -72, scale: 0.96, transition: { duration: 0.2, ease: 'easeIn' } }),
};

const copyVariants: Variants = {
  enter: { opacity: 1 },
  center: { opacity: 1, transition: { delayChildren: 0.12, staggerChildren: 0.08 } },
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
    // transform (slides, stagger, the drawings' own movement) and keeps fades.
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
            className={cn(
              'tap-target focus-ring -mr-2 rounded-md px-3 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground',
              isLast && 'invisible',
            )}
            aria-hidden={isLast}
            tabIndex={isLast ? -1 : 0}
            data-testid="button-skip"
          >
            Skip
          </button>
        </header>

        <main
          className="flex min-h-0 flex-1 flex-col justify-center"
          onTouchStart={onTouchStart}
          onTouchEnd={onTouchEnd}
          aria-roledescription="carousel"
          aria-label="What you can do with Bombino Express"
        >
          {/* The drawing is up to 400px tall and shrinks first on short phones;
              with the text under it, the pair sits centred on tall ones. */}
          <div className="flex min-h-0 shrink grow-0 basis-[400px] items-center justify-center overflow-hidden px-4 pt-2">
            <AnimatePresence mode="wait" custom={direction}>
              <motion.div
                key={slide.id}
                custom={direction}
                variants={visualVariants}
                initial="enter"
                animate="center"
                exit="exit"
                className="flex h-full w-full items-center justify-center"
                data-testid={`slide-${slide.id}`}
              >
                <Visual />
              </motion.div>
            </AnimatePresence>
          </div>

          {/* Heading and one line. Fixed min-height so the drawing above
              does not jump when a heading wraps on a narrow phone. */}
          <div className="min-h-[9.5rem] px-8 pt-4 text-center">
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
                <motion.h1
                  variants={lineVariants}
                  className="text-balance text-[28px] font-bold leading-[1.15] tracking-[-0.01em] text-foreground"
                >
                  {slide.title}
                </motion.h1>
                <motion.p
                  variants={lineVariants}
                  className="mx-auto mt-2.5 max-w-[30ch] text-balance text-base leading-relaxed text-muted-foreground"
                >
                  {slide.body}
                </motion.p>
              </motion.div>
            </AnimatePresence>
          </div>
        </main>

        <footer className="px-6 pb-5 pt-6">
          {/* Dots: the current one stretches into a pill. Each is a 44px-tall
              tap target around the visible mark. */}
          <div className="-my-3 flex justify-center gap-1" role="group" aria-label="Choose a slide">
            {slides.map((s, i) => (
              <button
                key={s.id}
                type="button"
                onClick={() => goTo(i)}
                className="focus-ring flex h-11 min-w-6 items-center justify-center rounded-md"
                aria-label={`Slide ${i + 1}: ${s.title}`}
                aria-current={i === index ? 'step' : undefined}
                data-testid={`dot-${i}`}
              >
                <motion.span
                  className="block h-2 rounded-full"
                  animate={{
                    width: i === index ? 24 : 8,
                    backgroundColor: i === index ? 'rgb(242 161 35)' : 'rgb(226 232 240)',
                  }}
                  transition={{ duration: 0.25, ease: EASE_OUT }}
                />
              </button>
            ))}
          </div>

          <div className="mt-5 flex gap-2.5">
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

          <div className="mt-2 flex justify-center">
            <button
              type="button"
              onClick={() => finish('/login')}
              className="focus-ring tap-target rounded-md px-3 text-sm font-semibold text-foreground underline-offset-4 hover:underline"
              data-testid="button-onboarding-login"
            >
              I have an account
            </button>
          </div>
        </footer>
      </div>
    </MotionConfig>
  );
}
