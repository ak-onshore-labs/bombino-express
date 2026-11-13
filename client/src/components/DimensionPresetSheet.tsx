import type { ReactElement } from 'react';
import { cn } from '@/lib/utils';
import { X, Check } from 'lucide-react';

export const DIMENSION_PRESETS = [
  {
    id: 'envelope',
    label: 'Document Envelope',
    cm: { l: '35', w: '25', h: '1' },
    in: { l: '14', w: '10', h: '0.5' },
  },
  {
    id: 'small',
    label: 'Small Parcel',
    cm: { l: '30', w: '20', h: '15' },
    in: { l: '12', w: '8', h: '6' },
  },
  {
    id: 'medium',
    label: 'Medium Parcel',
    cm: { l: '45', w: '35', h: '25' },
    in: { l: '18', w: '14', h: '10' },
  },
  {
    id: 'large',
    label: 'Large Parcel',
    cm: { l: '60', w: '45', h: '35' },
    in: { l: '24', w: '18', h: '14' },
  },
] as const;

export type PresetId = (typeof DIMENSION_PRESETS)[number]['id'];

function EnvelopeSVG() {
  return (
    <svg width="56" height="40" viewBox="0 0 56 40" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="2" y="18" width="44" height="18" rx="1" fill="#e8f0f7" stroke="#14567C" strokeWidth="1.5" />
      <path d="M2 18 L12 8 L56 8" stroke="#14567C" strokeWidth="1.5" />
      <path d="M46 18 L56 8" stroke="#14567C" strokeWidth="1.5" strokeDasharray="3 2" />
      <path d="M46 18 L46 36" stroke="#14567C" strokeWidth="1.5" />
      <path d="M46 36 L56 26 L56 8" stroke="#14567C" strokeWidth="1.5" strokeDasharray="3 2" />
      <polygon points="12,8 56,8 46,18 2,18" fill="#f0f6fb" stroke="#14567C" strokeWidth="1.5" />
      <rect x="16" y="8" width="14" height="3" rx="1" fill="#FBAD1F" opacity="0.8" />
    </svg>
  );
}

function SmallParcelSVG() {
  return (
    <svg width="56" height="48" viewBox="0 0 56 48" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="2" y="18" width="32" height="26" rx="1" fill="#e8f0f7" stroke="#14567C" strokeWidth="1.5" />
      <polygon points="2,18 14,8 46,8 34,18" fill="#f0f6fb" stroke="#14567C" strokeWidth="1.5" />
      <path d="M14 8 L14 38" stroke="#14567C" strokeWidth="1.5" strokeDasharray="3 2" />
      <path d="M46 8 L34 18" stroke="#14567C" strokeWidth="1.5" strokeDasharray="3 2" />
      <path d="M34 18 L34 44" stroke="#14567C" strokeWidth="1.5" />
      <path d="M34 44 L2 44" stroke="#14567C" strokeWidth="1.5" strokeDasharray="3 2" />
      <path d="M34 44 L46 34 L46 8" stroke="#14567C" strokeWidth="1.5" strokeDasharray="3 2" />
      <rect x="10" y="8" width="12" height="3" rx="1" fill="#FBAD1F" opacity="0.8" />
    </svg>
  );
}

function MediumParcelSVG() {
  return (
    <svg width="56" height="52" viewBox="0 0 56 52" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="2" y="16" width="34" height="32" rx="1" fill="#e8f0f7" stroke="#14567C" strokeWidth="1.5" />
      <polygon points="2,16 14,4 48,4 36,16" fill="#f0f6fb" stroke="#14567C" strokeWidth="1.5" />
      <path d="M14 4 L14 36" stroke="#14567C" strokeWidth="1.5" strokeDasharray="3 2" />
      <path d="M48 4 L36 16" stroke="#14567C" strokeWidth="1.5" strokeDasharray="3 2" />
      <path d="M36 16 L36 48" stroke="#14567C" strokeWidth="1.5" />
      <path d="M36 48 L2 48" stroke="#14567C" strokeWidth="1.5" strokeDasharray="3 2" />
      <path d="M36 48 L48 36 L48 4" stroke="#14567C" strokeWidth="1.5" strokeDasharray="3 2" />
      <rect x="10" y="4" width="16" height="3" rx="1" fill="#FBAD1F" opacity="0.8" />
      <line x1="19" y1="4" x2="19" y2="52" stroke="#FBAD1F" strokeWidth="1" strokeDasharray="2 2" opacity="0.5" />
    </svg>
  );
}

function LargeParcelSVG() {
  return (
    <svg width="56" height="52" viewBox="0 0 56 52" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="2" y="20" width="40" height="28" rx="1" fill="#e8f0f7" stroke="#14567C" strokeWidth="1.5" />
      <polygon points="2,20 12,10 52,10 42,20" fill="#f0f6fb" stroke="#14567C" strokeWidth="1.5" />
      <path d="M12 10 L12 38" stroke="#14567C" strokeWidth="1.5" strokeDasharray="3 2" />
      <path d="M52 10 L42 20" stroke="#14567C" strokeWidth="1.5" strokeDasharray="3 2" />
      <path d="M42 20 L42 48" stroke="#14567C" strokeWidth="1.5" />
      <path d="M42 48 L2 48" stroke="#14567C" strokeWidth="1.5" strokeDasharray="3 2" />
      <path d="M42 48 L52 38 L52 10" stroke="#14567C" strokeWidth="1.5" strokeDasharray="3 2" />
      <rect x="10" y="10" width="20" height="3" rx="1" fill="#FBAD1F" opacity="0.8" />
    </svg>
  );
}

const PRESET_SVGS: Record<PresetId, () => ReactElement> = {
  envelope: EnvelopeSVG,
  small: SmallParcelSVG,
  medium: MediumParcelSVG,
  large: LargeParcelSVG,
};

export interface DimensionPresetSheetProps {
  open: boolean;
  onClose: () => void;
  selectedPreset: PresetId | null;
  onSelectPreset: (id: PresetId | null, l: string, w: string, h: string) => void;
  dimUnit: 'in' | 'cm';
}

export function DimensionPresetSheet({
  open,
  onClose,
  selectedPreset,
  onSelectPreset,
  dimUnit,
}: DimensionPresetSheetProps) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="w-full max-w-lg bg-white rounded-t-2xl max-h-[min(80dvh,calc(var(--visible,100dvh)-var(--sat)))] overflow-y-auto shadow-xl pb-sheet safe-x"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="preset-sheet-title"
      >
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 bg-gray-200 rounded-full" />
        </div>
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h3 id="preset-sheet-title" className="font-semibold text-base text-gray-900">
            Choose package size
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="w-7 h-7 rounded-full bg-gray-100 flex items-center justify-center text-gray-500 hover:bg-gray-200 transition-colors"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-4 space-y-3">
          {DIMENSION_PRESETS.map((preset) => {
            const SvgComp = PRESET_SVGS[preset.id];
            const isSelected = selectedPreset === preset.id;
            return (
              <button
                key={preset.id}
                type="button"
                onClick={() => {
                  const vals = dimUnit === 'cm' ? preset.cm : preset.in;
                  onSelectPreset(preset.id, vals.l, vals.w, vals.h);
                  onClose();
                }}
                className={cn(
                  'w-full flex items-center',
                  'gap-3 p-3 rounded-xl',
                  'border text-left',
                  'transition-colors',
                  isSelected ? 'border-[#14567C] bg-blue-50' : 'border-border hover:border-[#14567C]/40'
                )}
              >
                <div className="shrink-0">
                  <SvgComp />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm text-gray-900">{preset.label}</p>
                  <p className="text-xs text-gray-600 mt-0.5">
                    {preset.cm.l} × {preset.cm.w} × {preset.cm.h} cm
                  </p>
                  <p className="text-xs text-gray-400">
                    {preset.in.l} × {preset.in.w} × {preset.in.h} in
                  </p>
                </div>
                <div
                  className={cn(
                    'shrink-0 w-5 h-5 rounded-full',
                    'flex items-center justify-center',
                    'border-2 transition-colors',
                    isSelected ? 'bg-[#14567C] border-[#14567C]' : 'border-gray-300'
                  )}
                >
                  {isSelected && <Check className="w-3 h-3 text-white" strokeWidth={3} />}
                </div>
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => {
              onSelectPreset(null, '', '', '');
              onClose();
            }}
            className="w-full p-3 rounded-xl border border-dashed border-border text-sm text-muted-foreground hover:border-[#14567C]/40 transition-colors text-center"
          >
            Enter custom dimensions manually
          </button>
        </div>
        <div className="h-2" />
      </div>
    </div>
  );
}
