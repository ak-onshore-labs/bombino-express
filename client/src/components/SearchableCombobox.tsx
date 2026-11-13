import {
  cloneElement,
  isValidElement,
  type CSSProperties,
  type JSX,
  type MouseEvent,
  type ReactElement,
  type ReactNode,
} from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandList,
} from '@/components/ui/command';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { useIsMobile } from '@/hooks/use-mobile';
import { cn } from '@/lib/utils';

export interface SearchableComboboxProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Sheet header label on phones. */
  title: string;
  searchPlaceholder: string;
  emptyText?: string;
  /** Trigger button (country field, dial-code chip, …). */
  trigger: ReactElement;
  /** Classes for the desktop PopoverContent. */
  popoverContentClassName?: string;
  /** Desktop Popover sideOffset (default 4, matching Radix). */
  popoverSideOffset?: number;
  /** Extra classes for CommandList (e.g. desktop max-h-72). */
  listClassName?: string;
  /** Extra props for CommandInput (e.g. style). */
  inputClassName?: string;
  inputStyle?: CSSProperties;
  children: ReactNode;
}

/**
 * Searchable option picker: full-height bottom sheet below md (search pinned,
 * list scrolls in the remaining --visible height above the keyboard); Popover
 * + Command at md and above, unchanged from the previous inline pattern.
 */
export function SearchableCombobox({
  open,
  onOpenChange,
  title,
  searchPlaceholder,
  emptyText = 'No results.',
  trigger,
  popoverContentClassName,
  popoverSideOffset,
  listClassName,
  inputClassName,
  inputStyle,
  children,
}: SearchableComboboxProps): JSX.Element {
  const isMobile = useIsMobile();

  const commandBody = (opts: { autoFocus?: boolean; fillHeight?: boolean }) => (
    <Command
      className={cn(
        'overflow-hidden rounded-none',
        opts.fillHeight && 'flex min-h-0 flex-1 flex-col',
      )}
    >
      <div className={cn(opts.fillHeight && 'shrink-0')}>
        <CommandInput
          placeholder={searchPlaceholder}
          className={inputClassName}
          style={inputStyle}
          autoFocus={opts.autoFocus}
        />
      </div>
      <CommandList
        className={
          opts.fillHeight
            ? 'max-h-none min-h-0 flex-1 overflow-y-auto'
            : listClassName
        }
      >
        <CommandEmpty>{emptyText}</CommandEmpty>
        <CommandGroup>{children}</CommandGroup>
      </CommandList>
    </Command>
  );

  if (isMobile) {
    const mobileTrigger = isValidElement(trigger)
      ? cloneElement(trigger as ReactElement<{ onClick?: (e: MouseEvent) => void; disabled?: boolean }>, {
          onClick: (e: MouseEvent) => {
            (trigger.props as { onClick?: (e: MouseEvent) => void }).onClick?.(e);
            if (!(trigger.props as { disabled?: boolean }).disabled) {
              onOpenChange(true);
            }
          },
        })
      : trigger;

    return (
      <>
        {mobileTrigger}
        <Sheet open={open} onOpenChange={onOpenChange}>
          <SheetContent
            side="bottom"
            className={cn(
              'flex h-[calc(var(--visible,100dvh)-var(--sat))] max-h-[calc(var(--visible,100dvh)-var(--sat))]',
              'flex-col gap-0 overflow-hidden rounded-t-2xl',
              // Beat base p-6 / variant padding, keep safe-area on the edges we touch.
              'p-0 pl-[var(--sal)] pr-[var(--sar)] pb-[var(--sab)]',
            )}
          >
            <SheetHeader className="shrink-0 space-y-0 border-b border-border px-4 py-3 pr-12 text-left">
              <SheetTitle className="text-base">{title}</SheetTitle>
            </SheetHeader>
            {commandBody({ autoFocus: true, fillHeight: true })}
          </SheetContent>
        </Sheet>
      </>
    );
  }

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent
        className={cn('p-0', popoverContentClassName)}
        align="start"
        sideOffset={popoverSideOffset}
      >
        {commandBody({})}
      </PopoverContent>
    </Popover>
  );
}
