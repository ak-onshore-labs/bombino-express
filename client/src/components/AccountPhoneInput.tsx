import { forwardRef, useState, type KeyboardEvent } from 'react';
import { ChevronDown } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import {
  ACCOUNT_PHONE_COUNTRIES,
  INDIA,
  splitAccountPhone,
  toAccountPhone,
  type PhoneCountry,
} from '@shared/contact';

interface AccountPhoneInputProps {
  /** The stored form: "9876543210" for India, "+97450123456" abroad. */
  value: string;
  onChange: (stored: string) => void;
  onEnter?: () => void;
  id?: string;
  disabled?: boolean;
  /** Classes for the number box. The country picker matches its height. */
  className?: string;
  'aria-invalid'?: boolean;
  'aria-describedby'?: string;
  'data-testid'?: string;
}

/**
 * A customer's own mobile number: a country picker and the local number.
 *
 * India is the default and behaves exactly as the old 10-digit box did. The
 * other countries are the ones MSG91 can send a login code to
 * (INTERNATIONAL_PHONE_COUNTRIES in shared/contact.ts) — nothing else is
 * offered, so a customer can never type a number we cannot reach.
 *
 * The value going in and out is the stored form, so callers keep one string
 * and send it to the server as it is.
 */
export const AccountPhoneInput = forwardRef<HTMLInputElement, AccountPhoneInputProps>(
  function AccountPhoneInput(
    { value, onChange, onEnter, id, disabled, className, ...rest },
    ref
  ) {
    // Held separately: an empty value cannot say which country was picked.
    const [country, setCountry] = useState<PhoneCountry>(() => splitAccountPhone(value).country);
    const local = value ? splitAccountPhone(value).local : '';

    const pickCountry = (dialCode: string): void => {
      const next = ACCOUNT_PHONE_COUNTRIES.find((c) => c.dialCode === dialCode) ?? INDIA;
      setCountry(next);
      onChange(local ? toAccountPhone(next.dialCode, local) : '');
    };

    const onKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
      if (e.key === 'Enter' && onEnter) {
        e.preventDefault();
        onEnter();
      }
    };

    return (
      <div className="flex items-stretch gap-2">
        <div className="relative shrink-0">
          <select
            aria-label="Country code"
            value={country.dialCode}
            onChange={(e) => pickCountry(e.target.value)}
            disabled={disabled}
            className={cn(
              'h-full appearance-none rounded-xl border border-[#E2E8F0] bg-[#F3F4F6] pl-3 pr-7 text-sm font-medium',
              'focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50'
            )}
            data-testid="select-phone-country"
          >
            {ACCOUNT_PHONE_COUNTRIES.map((c) => (
              <option key={c.iso} value={c.dialCode}>
                {c.flag} +{c.dialCode}
              </option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        </div>
        <Input
          id={id}
          ref={ref}
          type="tel"
          inputMode="numeric"
          autoComplete="tel-national"
          value={local}
          onChange={(e) => {
            const raw = e.target.value;
            if (!raw.trim()) {
              onChange('');
              return;
            }
            // A pasted "+974 5012 3456" picks its own country.
            if (raw.trim().startsWith('+')) {
              const digits = raw.replace(/\D/g, '');
              const pasted = ACCOUNT_PHONE_COUNTRIES.find(
                (c) => c.dialCode !== country.dialCode && digits.startsWith(c.dialCode)
              );
              if (pasted) {
                setCountry(pasted);
                onChange(toAccountPhone(pasted.dialCode, digits.slice(pasted.dialCode.length)));
                return;
              }
            }
            onChange(toAccountPhone(country.dialCode, raw));
          }}
          onKeyDown={onKeyDown}
          placeholder={country.example}
          disabled={disabled}
          className={cn('min-w-0 flex-1', className)}
          {...rest}
        />
      </div>
    );
  }
);
