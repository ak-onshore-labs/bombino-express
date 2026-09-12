import type { BiaCardTone } from '@shared/biaCards';

/**
 * The look BIA's cards share (BiaCards.tsx, DocUploadCard.tsx). Status colours
 * are dark-tuned copies of the app's badge tones, for the chat's dark ground.
 */
export const TONE_CLASS: Record<BiaCardTone, string> = {
  gray: 'bg-white/10 text-white/70',
  blue: 'bg-sky-400/15 text-sky-200',
  amber: 'bg-amber-400/15 text-amber-200',
  green: 'bg-emerald-400/15 text-emerald-200',
  red: 'bg-red-400/15 text-red-200',
  orange: 'bg-orange-400/20 text-orange-200',
};

export const CARD = 'w-full rounded-xl border border-white/[0.12] bg-white/[0.05] px-3 py-2.5 text-left';
