import { forwardRef, useEffect, useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { CommandItem } from '@/components/ui/command';
import { SearchableCombobox } from '@/components/SearchableCombobox';
import { cn } from '@/lib/utils';
import { supportsFlagEmoji } from '@/lib/flagEmoji';
import {
  ACCOUNT_PHONE_COUNTRIES,
  INDIA,
  phoneCountryByIso,
  splitAccountPhone,
  toAccountPhone,
  type PhoneCountry,
} from '@shared/contact';

interface AccountPhoneInputProps {
  /** The stored form: "9876543210" for India, "+97450113086" abroad. */
  value: string;
  onChange: (stored: string) => void;
  onEnter?: () => void;
  /**
   * ISO code the country starts on while the field is empty (India if not
   * given). When it changes, the field moves to it and keeps what was typed.
   */
  defaultCountry?: string;
  /** Placeholder for the number part. */
  placeholder?: string;
  id?: string;
  disabled?: boolean;
  /** Classes for the whole field (height, background, border, radius). */
  className?: string;
  'aria-invalid'?: boolean;
  'aria-describedby'?: string;
  'data-testid'?: string;
}

/**
 * index.css gives every focused <input> a glow, unlayered, so a utility class
 * cannot turn it off. Inside this field the whole box glows instead.
 */
const NO_FOCUS_GLOW = { boxShadow: 'none' } as const;

/** The flag, or the country's letters in a small badge where flags don't draw (Windows). */
function CountryMark({ country }: { country: PhoneCountry }) {
  if (supportsFlagEmoji()) {
    return (
      <span className="text-lg leading-none" aria-hidden>
        {country.flag}
      </span>
    );
  }
  return (
    <span
      className="inline-flex h-4 min-w-[22px] items-center justify-center rounded-[3px] bg-foreground/10 px-1 text-[10px] font-bold tracking-wide text-foreground/80"
      aria-hidden
    >
      {country.iso}
    </span>
  );
}

/**
 * A customer's own mobile number: one field, with the country inside it.
 *
 *   [ 🇮🇳 +91 ⌄ | 98765 43210 ]
 *
 * India is the default and behaves exactly as the old 10-digit box did. The
 * country button opens a searchable list of every country (by name or code).
 * The value going in and out is the stored form, so callers keep one string
 * and send it to the server as it is.
 */
export const AccountPhoneInput = forwardRef<HTMLInputElement, AccountPhoneInputProps>(
  function AccountPhoneInput(
    { value, onChange, onEnter, defaultCountry, placeholder, id, disabled, className, ...rest },
    ref,
  ) {
    // Held separately: an empty value cannot say which country was picked, and
    // +1 is shared by several.
    const [country, setCountry] = useState<PhoneCountry>(() =>
      value
        ? splitAccountPhone(value, defaultCountry).country
        : (defaultCountry && phoneCountryByIso(defaultCountry)) || INDIA,
    );
    const [open, setOpen] = useState(false);
    const local = value ? splitAccountPhone(value, country.iso).local : '';

    // A new default (the booking's destination changed): follow it, and carry
    // the digits already typed over to the new dial code.
    const lastDefault = useRef(defaultCountry);
    useEffect(() => {
      if (defaultCountry === lastDefault.current) return;
      lastDefault.current = defaultCountry;
      const next = defaultCountry ? phoneCountryByIso(defaultCountry) : null;
      if (!next || next.iso === country.iso) return;
      setCountry(next);
      if (local) onChange(toAccountPhone(next.iso, local));
      // Only a change of default moves the field; typing never does.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [defaultCountry]);

    // A number set from outside (a saved address) brings its own country.
    useEffect(() => {
      if (!value) return;
      const own = splitAccountPhone(value, country.iso).country;
      if (own.iso !== country.iso) setCountry(own);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [value]);

    const pick = (next: PhoneCountry): void => {
      setCountry(next);
      setOpen(false);
      onChange(local ? toAccountPhone(next.iso, local) : '');
    };

    const onType = (raw: string): void => {
      if (!raw.trim()) {
        onChange('');
        return;
      }
      // A pasted "+974 5011 3086" picks its own country.
      if (raw.trim().startsWith('+')) {
        const pasted = splitAccountPhone(`+${raw.replace(/\D/g, '')}`, country.iso).country;
        if (pasted.iso !== country.iso) {
          setCountry(pasted);
          onChange(toAccountPhone(pasted.iso, raw));
          return;
        }
      }
      onChange(toAccountPhone(country.iso, raw));
    };

    const items = ACCOUNT_PHONE_COUNTRIES.map((c) => (
      <CommandItem
        key={c.iso}
        // What the search matches: name, code with and without "+", ISO.
        value={`${c.name} +${c.dialCode} ${c.dialCode} ${c.iso}`}
        onSelect={() => pick(c)}
        className="gap-2.5"
        data-testid={`option-country-${c.iso}`}
      >
        <CountryMark country={c} />
        <span className="min-w-0 flex-1 truncate">{c.name}</span>
        <span className="text-xs tabular-nums text-muted-foreground">+{c.dialCode}</span>
        <Check className={cn('h-4 w-4 text-primary', c.iso === country.iso ? 'opacity-100' : 'opacity-0')} />
      </CommandItem>
    ));

    return (
      <div
        className={cn(
          'flex h-12 items-stretch overflow-hidden rounded-xl border border-[#E2E8F0] bg-[#F3F4F6]',
          // The same focus look every other input has (index.css), on the whole field.
          'transition-shadow focus-within:border-[#2F4468] focus-within:shadow-[0_0_0_3px_oklch(37%_0.092_245/0.40)]',
          className,
        )}
      >
        <SearchableCombobox
          open={open}
          onOpenChange={setOpen}
          title="Country"
          searchPlaceholder="Search country or code"
          emptyText="No country found."
          popoverContentClassName="w-[min(20rem,calc(100vw-2rem))]"
          popoverSideOffset={6}
          listClassName="max-h-72"
          inputClassName="border-0"
          inputStyle={NO_FOCUS_GLOW}
          trigger={
            <button
              type="button"
              disabled={disabled}
              aria-label={`Country: ${country.name} +${country.dialCode}. Change country`}
              className="flex shrink-0 items-center gap-1.5 pl-3 pr-2 text-sm font-semibold text-foreground transition-colors hover:bg-black/[0.04] focus:outline-none disabled:cursor-not-allowed"
              data-testid="button-phone-country"
            >
              <CountryMark country={country} />
              <span className="tabular-nums">+{country.dialCode}</span>
              {/* Locked (already verified, or a request in flight): no arrow, nothing to open. */}
              {!disabled && <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />}
            </button>
          }
        >
          {items}
        </SearchableCombobox>

        <span className="my-3 w-px shrink-0 bg-[#D7DDE5]" aria-hidden />

        <input
          id={id}
          ref={ref}
          type="tel"
          inputMode="numeric"
          autoComplete="tel-national"
          value={local}
          onChange={(e) => onType(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && onEnter) {
              e.preventDefault();
              onEnter();
            }
          }}
          placeholder={placeholder ?? (country.iso === INDIA.iso ? '98765 43210' : 'Mobile number')}
          disabled={disabled}
          className="min-w-0 flex-1 border-0 bg-transparent px-3 text-base tabular-nums text-foreground outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed"
          style={NO_FOCUS_GLOW}
          {...rest}
        />
      </div>
    );
  },
);
