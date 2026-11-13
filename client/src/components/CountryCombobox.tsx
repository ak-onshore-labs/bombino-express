import { useState, type JSX } from 'react';
import { ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CommandItem } from '@/components/ui/command';
import { SearchableCombobox } from '@/components/SearchableCombobox';
import { formatCountryDisplay } from '@/lib/itdCountryData';
import { cn } from '@/lib/utils';

export interface CountryComboboxCountry {
  code: string;
  name: string;
}

export interface CountryComboboxProps {
  value: string;
  onValueChange: (code: string) => void;
  countries: CountryComboboxCountry[];
  /** Sheet header / field label context. */
  title: string;
  /** Empty-state trigger text. When omitted, shows the formatted value or code. */
  placeholder?: string;
  /** Error / layout classes on the trigger. */
  className?: string;
  /** Extra classes always applied to the trigger (Rates desktop sizing). */
  triggerClassName?: string;
  'data-testid'?: string;
}

export function CountryCombobox({
  value,
  onValueChange,
  countries,
  title,
  placeholder,
  className,
  triggerClassName,
  'data-testid': testId,
}: CountryComboboxProps): JSX.Element {
  const [open, setOpen] = useState(false);
  const selected = countries.find((c) => c.code === value);
  const displayName = selected
    ? formatCountryDisplay(selected.name)
    : value
      ? formatCountryDisplay(value)
      : null;
  const showPlaceholder = !displayName && Boolean(placeholder);

  return (
    <SearchableCombobox
      open={open}
      onOpenChange={setOpen}
      title={title}
      searchPlaceholder="Search country…"
      emptyText="No country found."
      popoverContentClassName="w-[var(--radix-popover-trigger-width)]"
      trigger={
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          data-testid={testId}
          className={cn(
            'w-full h-11 justify-between font-normal text-sm bg-muted/30 border-border rounded-xl px-3',
            triggerClassName,
            className,
          )}
        >
          <span className={cn('truncate text-left', showPlaceholder && 'text-muted-foreground')}>
            {displayName ?? placeholder ?? ''}
          </span>
          <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      }
    >
      {countries.map((c) => (
        <CommandItem
          key={c.code}
          value={`${c.name} ${c.code}`}
          onSelect={() => {
            onValueChange(c.code);
            setOpen(false);
          }}
        >
          {formatCountryDisplay(c.name)}
        </CommandItem>
      ))}
    </SearchableCombobox>
  );
}
