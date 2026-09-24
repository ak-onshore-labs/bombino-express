import React, { useEffect, useMemo, useRef, useState } from 'react';
import { HSN_DESCRIPTIONS, getHsnCode } from '@shared/hsn';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

export interface ShipmentContentSearchProps {
  value: string;
  onChange: (value: string) => void;
  onSelect: (description: string, hsCode: string) => void;
  error?: boolean;
}

export function ShipmentContentSearch({
  value,
  onChange,
  onSelect,
  error,
}: ShipmentContentSearchProps): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const suggestions = useMemo(() => {
    const q = value.trim();
    if (q.length < 2) {
      return [];
    }
    const lower = q.toLowerCase();
    const out: string[] = [];
    for (let i = 0; i < HSN_DESCRIPTIONS.length && out.length < 8; i++) {
      const d = HSN_DESCRIPTIONS[i];
      if (d.toLowerCase().includes(lower)) {
        out.push(d);
      }
    }
    return out;
  }, [value]);

  useEffect(() => {
    function handleDocMouseDown(ev: MouseEvent): void {
      if (!containerRef.current?.contains(ev.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleDocMouseDown);
    return () => document.removeEventListener('mousedown', handleDocMouseDown);
  }, []);

  function handlePick(desc: string): void {
    onChange(desc);
    onSelect(desc, getHsnCode(desc));
    setOpen(false);
  }

  function handleBlur(): void {
    const t = value.trim();
    if (!t) {
      onSelect('', '');
      return;
    }
    const code = getHsnCode(t);
    onSelect(t, code || '');
  }

  return (
    <div ref={containerRef} className="relative">
      <Label className="text-xs text-muted-foreground">
        Shipment Content <span className="text-red-400">*</span>
      </Label>
      <Input
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          if (e.target.value.trim().length >= 2) {
            setOpen(true);
          } else {
            setOpen(false);
          }
        }}
        onFocus={() => {
          if (value.trim().length >= 2) {
            setOpen(true);
          }
        }}
        onBlur={() => {
          handleBlur();
        }}
        placeholder="e.g. BOOKS, CLOTHES, ELECTRONICS"
        className={cn(
          'h-11 mt-1 text-sm bg-muted/30 border-border rounded-xl',
          error && 'border-2 border-primary',
        )}
        data-testid="input-shipment-content"
        autoComplete="off"
      />
      {open && suggestions.length > 0 && (
        <ul
          className="absolute z-50 left-0 right-0 mt-1 max-h-48 overflow-auto rounded-xl border border-border bg-card text-foreground shadow-md p-1"
          role="listbox"
        >
          {suggestions.map((d) => (
            <li key={d}>
              <button
                type="button"
                className="w-full text-left text-xs px-3 py-2 rounded-lg hover:bg-muted"
                onMouseDown={(e) => {
                  e.preventDefault();
                  handlePick(d);
                }}
              >
                {d}
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="text-[10px] text-muted-foreground mt-1.5">
        Describe what you&apos;re shipping for customs
      </p>
    </div>
  );
}
