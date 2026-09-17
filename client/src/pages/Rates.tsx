import type { CSSProperties } from 'react';
import { useLayoutEffect, useMemo, useState } from 'react';
import { formatCountryDisplay } from '@/lib/itdCountryData';
import {
  dedupeAndSort,
  formatInr,
  itemizedChargesEmpty,
  normalizeRateRow,
  type ITDChargeApplyEntry,
  type ITDRateResponse,
  type ITDRateRow,
  type RateParams,
} from '@/lib/itdRates';
import { ArrowLeft, ArrowRight, ChevronDown, Info, Loader2, AlertTriangle, Phone } from 'lucide-react';
import { useLocation } from 'wouter';
import { useMutation } from '@tanstack/react-query';
import { Header } from '@/components/Header';
import { BottomNav } from '@/components/BottomNav';
import { SideMenu } from '@/components/SideMenu';
import { Button } from '@/components/ui/button';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import whatsAppLogo from '@/assets/WhatsApp.svg.png';
import { COUNTRY_LIST, COUNTRY_MAP, isBookableCorridor } from '@/lib/countryData';
import { lbToKg, kgToLb } from '@/lib/units';
import { apiRequest } from '@/lib/queryClient';
import { cn } from '@/lib/utils';

interface ShipmentMeta {
  weightLb: number;
  weightKg: number;
  pieces: number;
}

const BOMBINO_BLUE = '#14567C';
const BEST_GREEN = '#166534';
const BEST_BADGE_BG = '#dcfce7';

const ratesResultsShellStyle = {
  '--color-background-primary': '#ffffff',
  '--color-background-secondary': 'rgb(247 247 249)',
  '--color-border-tertiary': 'rgba(55, 65, 81, 0.12)',
} as CSSProperties;

interface CountryComboboxProps {
  value: string;
  onValueChange: (code: string) => void;
}

function CountryCombobox({ value, onValueChange }: CountryComboboxProps) {
  const [open, setOpen] = useState(false);
  const displayName = formatCountryDisplay(COUNTRY_MAP[value] ?? value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full h-11 justify-between font-normal text-sm bg-muted/30 border-border rounded-xl px-3 md:h-auto md:text-base md:font-medium"
        >
          <span className="truncate text-left">{displayName}</span>
          <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="p-0 w-[var(--radix-popover-trigger-width)]" align="start">
        <Command>
          <CommandInput placeholder="Search country…" className="h-11" />
          <CommandList>
            <CommandEmpty>No country found.</CommandEmpty>
            <CommandGroup>
              {COUNTRY_LIST.map((c) => (
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
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

export default function Rates() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [, setLocation] = useLocation();

  const [weightUnit, setWeightUnit] = useState<'lb' | 'kg'>('kg');
  const [weight, setWeight] = useState('2');
  const [pieces, setPieces] = useState('1');
  const [originPincode, setOriginPincode] = useState('');
  const [destPincode, setDestPincode] = useState('');

  const [rateResults, setRateResults] = useState<ITDRateRow[] | null>(null);
  const [shipmentMeta, setShipmentMeta] = useState<ShipmentMeta | null>(null);
  const [apiError, setApiError] = useState('');
  const [expandedById, setExpandedById] = useState<Record<string, boolean>>({});
  const [selectedRate, setSelectedRate] = useState<ITDRateRow | null>(null);

  const [selectedOrigin, setSelectedOrigin] = useState('IN');
  const [selectedDestination, setSelectedDestination] = useState('US');

  const clearRatesOnCorridorChange = (): void => {
    setRateResults(null);
    setShipmentMeta(null);
    setSelectedRate(null);
    setApiError('');
    setExpandedById({});
    setOriginPincode('');
    setDestPincode('');
  };

  const handleOriginChange = (code: string): void => {
    setSelectedOrigin(code);
    clearRatesOnCorridorChange();
  };

  const handleDestinationChange = (code: string): void => {
    setSelectedDestination(code);
    clearRatesOnCorridorChange();
  };

  const displayRates = useMemo(() => {
    if (!rateResults?.length) return [];
    return dedupeAndSort(rateResults);
  }, [rateResults]);

  useLayoutEffect(() => {
    if (displayRates.length === 0) return;
    const bestId = displayRates[0].id;
    setExpandedById({ [bestId]: true });
  }, [displayRates]);

  const rateMutation = useMutation({
    mutationFn: (params: RateParams) =>
      apiRequest('POST', '/api/rates', params).then((r) => r.json() as Promise<ITDRateResponse>),
    onSuccess: (data) => {
      const w = parseFloat(weight) || 1;
      const weightLb = weightUnit === 'lb' ? w : kgToLb(w);
      const weightKg = weightUnit === 'kg' ? w : lbToKg(w);

      const rawList: unknown[] = Array.isArray(data)
        ? (data as unknown[])
        : Array.isArray(data?.data)
          ? (data.data as unknown[])
          : [];

      const services: ITDRateRow[] = rawList
        .map((item) => normalizeRateRow(item))
        .filter((row): row is ITDRateRow => row !== null);

      if (services.length === 0) {
        setApiError('No rates available for this shipment.');
      } else {
        setShipmentMeta({
          weightLb: parseFloat(weightLb.toFixed(1)),
          weightKg: parseFloat(weightKg.toFixed(2)),
          pieces: parseInt(pieces) || 1,
        });
        setRateResults(services);
      }
    },
    onError: (err) => {
      const msg = err instanceof Error ? err.message.replace(/^\d+:\s*/, '') : 'Rate calculation failed';
      setApiError(msg);
    },
  });

  const handleGetRates = () => {
    setApiError('');
    const w = parseFloat(weight) || 1;
    const weightKg = weightUnit === 'kg' ? w : lbToKg(w);

    rateMutation.mutate({
      product_code: 'SPX',
      destination_code: selectedDestination,
      booking_date: new Date().toISOString().split('T')[0],
      origin_code: selectedOrigin,
      pcs: String(parseInt(pieces) || 1),
      actual_weight: String(weightKg.toFixed(2)),
      ori_city: 'MUMBAI',
      ori_pincode: originPincode.trim() || '400001',
      ...(destPincode.trim() ? { dest_pincode: destPincode.trim() } : {}),
    });
  };

  const handleBack = () => {
    if (rateResults) {
      setRateResults(null);
      setShipmentMeta(null);
    } else {
      setLocation('/home');
    }
  };

  const handleBookRate = (service: ITDRateRow) => {
    setSelectedRate(service);
    const q = encodeURIComponent(service.code);
    setLocation(`/create?api_service_code=${q}`);
  };

  if (rateResults && shipmentMeta) {
    const weightKgLabel = `${shipmentMeta.weightKg} kg`;
    const piecesLabel =
      shipmentMeta.pieces === 1 ? '1 piece' : `${shipmentMeta.pieces} pieces`;

    const bookable = isBookableCorridor(selectedOrigin, selectedDestination);
    const corridorLabel = `${formatCountryDisplay(COUNTRY_MAP[selectedOrigin] ?? selectedOrigin)} → ${formatCountryDisplay(COUNTRY_MAP[selectedDestination] ?? selectedDestination)}`;

    return (
      <div
        className="min-h-[100dvh] pb-nav bg-[#F8F9FA]"
        data-testid="screen-rates-results"
      >
        {/* Centered content wrapper — constrains width on desktop, transparent on mobile */}
        <div className="max-w-2xl mx-auto w-full px-4 md:px-6 md:py-6">
          <header className="pt-[max(0.75rem,env(safe-area-inset-top))] pb-3 md:pt-0 md:pb-5">
            <div className="flex items-center gap-2 md:mb-4">
              <button
                type="button"
                onClick={handleBack}
                className="p-2 -ml-2 rounded-lg hover:bg-black/[0.04] transition-colors"
                data-testid="button-back-rates"
              >
                <ArrowLeft className="w-5 h-5 text-foreground" />
              </button>
              <h1 className="text-base font-medium text-foreground tracking-tight md:text-2xl md:font-bold md:text-[lab(34.0831_-9.57756_-27.7093)]">Rate options</h1>
            </div>

            <div className="mt-4 flex flex-wrap gap-2 md:gap-2.5 md:mt-3">
              <span className="inline-flex items-center rounded-full bg-white border border-[#E2E8F0] px-3 py-[5px] text-[12px] text-foreground md:px-3.5 md:py-1.5 md:text-xs md:font-medium">
                <span className="font-mono">{weightKgLabel}</span>
              </span>
              <span className="inline-flex items-center rounded-full bg-white border border-[#E2E8F0] px-3 py-[5px] text-[12px] text-foreground md:px-3.5 md:py-1.5 md:text-xs md:font-medium">
                <span className="font-mono">{piecesLabel}</span>
              </span>
              <span className="inline-flex items-center rounded-full bg-white border border-[#E2E8F0] px-3 py-[5px] text-[12px] font-medium text-foreground md:px-3.5 md:py-1.5 md:text-xs">
                {corridorLabel}
              </span>
            </div>

            <div className="mt-3 flex items-center justify-between text-[12px] text-muted-foreground md:text-xs">
              <span><span className="font-mono">{displayRates.length}</span> services available</span>
              <span>sorted by lowest price</span>
            </div>
          </header>

          <main className="pb-2 md:pb-8">
            {!bookable ? (
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-4">
                <div className="flex gap-3">
                  <Info className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-amber-950">Online booking not available</p>
                    <p className="text-xs text-amber-800/90 mt-1 leading-snug">
                      For this corridor, please contact us to create your shipment.
                    </p>
                    <div className="flex gap-2 mt-3">
                      <a
                        href="https://api.whatsapp.com/send?phone=917045999553"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex-1 flex items-center justify-center gap-2 h-10 rounded-lg bg-green-600 text-white text-xs font-medium hover:bg-green-700 active:scale-[0.98] transition-colors"
                      >
                        <img src={whatsAppLogo} alt="" className="w-4 h-4 object-contain" />
                        WhatsApp
                      </a>
                      <a
                        href="tel:+912266400000"
                        className="flex-1 flex items-center justify-center gap-2 h-10 rounded-lg border border-amber-300 bg-white text-amber-950 text-xs font-medium hover:bg-amber-100/80 active:scale-[0.98] transition-colors"
                      >
                        <Phone className="w-4 h-4" aria-hidden />
                        Call
                      </a>
                    </div>
                  </div>
                </div>
              </div>
            ) : null}

            <div className="flex flex-col gap-3">
              {displayRates.map((service, idx) => {
                const isBest = idx === 0;
                const displayName = service.code || service.internal_api_service_code || 'Service';
                const letter = displayName.trim().charAt(0).toUpperCase() || '?';
                const gstTotal = service.cgst + service.sgst;
                const open = !!expandedById[service.id];
                const weightStr = service.weight?.trim() || String(shipmentMeta.weightKg);
                const itemizedEmpty = itemizedChargesEmpty(service);
                const showOtherChargesAggregate =
                  service.other_charges > 0 && itemizedEmpty;

                const toggle = () => {
                  setExpandedById((prev) => ({
                    ...prev,
                    [service.id]: !prev[service.id],
                  }));
                };

                return (
                  <div
                    key={service.id}
                    className="rounded-xl border border-[#E2E8F0] bg-white overflow-hidden shadow-[0_2px_12px_oklch(17%_0.048_248_/_0.06),_0_1px_3px_oklch(17%_0.048_248_/_0.04)] md:rounded-2xl"
                    data-testid={`rate-card-${idx}`}
                  >
                    <div className="flex items-center gap-3 px-4 pt-4 pb-3 md:px-6 md:pt-5 md:pb-4 md:gap-4">
                      <div
                        className="w-9 h-9 shrink-0 rounded-xl flex items-center justify-center text-[13px] font-semibold text-white md:w-11 md:h-11 md:text-base"
                        style={{ backgroundColor: isBest ? BEST_GREEN : '#2F4468' }}
                      >
                        {letter}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-[13px] font-semibold text-[lab(34.0831_-9.57756_-27.7093)] leading-snug md:text-base">{displayName}</p>
                        <div className="mt-0.5 flex flex-wrap items-center gap-2">
                          <span className="text-[11px] text-muted-foreground font-mono md:text-xs">
                            {weightStr} kg chargeable
                          </span>
                          {isBest && (
                            <span
                              className="inline-block rounded-full px-2 py-0.5 text-[9px] font-semibold tracking-wide uppercase"
                              style={{ backgroundColor: BEST_BADGE_BG, color: BEST_GREEN }}
                            >
                              Best value
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="text-[20px] font-semibold tabular-nums font-mono text-[#2F4468] md:text-2xl">
                          {formatInr(service.total)}
                        </p>
                        <p className="text-[10px] text-muted-foreground md:text-xs">incl. GST</p>
                      </div>
                    </div>

                    <div className="h-px bg-[#E2E8F0]" />

                    <button
                      type="button"
                      onClick={toggle}
                      className="w-full flex items-center justify-between px-4 py-2.5 text-left hover:bg-[#F8F9FA] transition-colors md:px-6 md:py-3"
                    >
                      <span className="text-[11px] text-muted-foreground md:text-xs">
                        {open ? 'Hide breakdown' : 'View price breakdown'}
                      </span>
                      <ChevronDown
                        className={cn(
                          'w-[11px] h-[11px] text-muted-foreground shrink-0 transition-transform duration-200',
                          open && 'rotate-180'
                        )}
                      />
                    </button>

                    {open && (
                      <div className="bg-[#F8F9FA] px-4 py-4 border-t border-[#E2E8F0] md:px-6 md:py-5">
                        <div className="space-y-2.5">
                          <div className="flex justify-between gap-3 text-[11px] md:text-xs">
                            <span className="text-muted-foreground">Base rate</span>
                            <span className="font-medium tabular-nums font-mono">{formatInr(service.rate)}</span>
                          </div>
                          {service.fsc !== 0 && (
                            <div className="flex justify-between gap-3 text-[11px] md:text-xs">
                              <span className="text-muted-foreground">Fuel surcharge (FSC)</span>
                              <span className="font-medium tabular-nums font-mono">{formatInr(service.fsc)}</span>
                            </div>
                          )}
                          {!itemizedEmpty &&
                            Object.values(service.chrage_apply_data!)
                              .filter((entry) => entry.amount !== 0)
                              .map((entry, i) => (
                                <div key={`${service.id}-chg-${i}`} className="flex justify-between gap-3 text-[11px] md:text-xs">
                                  <span className="text-muted-foreground">{entry.name}</span>
                                  <span className="font-medium tabular-nums font-mono">{formatInr(entry.amount)}</span>
                                </div>
                              ))}
                          {showOtherChargesAggregate && (
                            <div className="flex justify-between gap-3 text-[11px] md:text-xs">
                              <span className="text-muted-foreground">Other charges</span>
                              <span className="font-medium tabular-nums font-mono">{formatInr(service.other_charges)}</span>
                            </div>
                          )}
                        </div>

                        <div className="my-3 h-px bg-[#E2E8F0]" />

                        <div className="space-y-2.5">
                          {service.sub_total !== 0 && (
                            <div className="flex justify-between gap-3 text-[11px] md:text-xs">
                              <span className="text-muted-foreground">Sub-total</span>
                              <span className="font-medium tabular-nums font-mono">{formatInr(service.sub_total)}</span>
                            </div>
                          )}
                          {gstTotal !== 0 && (
                            <div className="flex justify-between gap-3 text-[11px] md:text-xs">
                              <span className="text-muted-foreground">
                                GST ({service.gst_per || '0'}%)
                              </span>
                              <span className="font-medium tabular-nums font-mono">{formatInr(gstTotal)}</span>
                            </div>
                          )}
                        </div>

                        <div className="my-3 h-px bg-[#E2E8F0]" />

                        <div className="flex justify-between gap-3 items-baseline">
                          <span className="text-[11px] text-[lab(34.0831_-9.57756_-27.7093)] font-semibold md:text-xs">Total payable</span>
                          <span className="text-[14px] font-semibold tabular-nums font-mono text-[#2F4468] md:text-base">
                            {formatInr(service.total)}
                          </span>
                        </div>

                        {bookable ? (
                          <button
                            type="button"
                            className="mt-3 w-full h-10 rounded-xl text-[13px] font-semibold bg-[#F2A123] text-[lab(34.0831_-9.57756_-27.7093)] hover:bg-[#F2A123]/90 active:scale-[0.98] transition-all md:h-12 md:rounded-xl md:text-sm md:mt-4"
                            onClick={() => handleBookRate(service)}
                          >
                            Book this rate
                          </button>
                        ) : null}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <p className="text-[10px] text-muted-foreground text-center mt-6 px-4 leading-relaxed md:text-xs md:px-0">
              Rates are indicative and subject to change based on actual shipment weight and dimensions at the time of pickup. Final charges may vary.
            </p>
          </main>
        </div>

        {selectedRate ? (
          <span className="sr-only" aria-live="polite">
            Selected rate: {selectedRate.code}
          </span>
        ) : null}

        <BottomNav />
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] bg-background pb-nav" data-testid="screen-rates">
      <Header onMenuClick={() => setMenuOpen(true)} />
      <SideMenu isOpen={menuOpen} onClose={() => setMenuOpen(false)} />

      <main className="px-4 py-5 max-w-md mx-auto md:max-w-3xl md:px-0 md:py-2">
        <div className="hidden md:flex md:items-center md:gap-2 md:mb-2">
          <span className="text-[10px] font-bold tracking-[0.18em] uppercase text-[#F2A123]">Calculator</span>
          <span className="h-px flex-1 bg-gradient-to-r from-[#F2A123]/30 to-transparent" aria-hidden />
        </div>
        <h1 className="text-lg font-semibold text-foreground mb-1 md:text-[26px] md:font-bold md:mb-1 md:tracking-[-0.02em] md:text-[lab(34.0831_-9.57756_-27.7093)]">Get Rates</h1>
        <p className="hidden md:block text-sm text-muted-foreground mb-6">
          Instant rates for international shipments from India
        </p>

        <div className="mb-5 space-y-3 md:mb-6">
          <div className="flex items-end gap-2 md:gap-0 md:items-stretch md:bg-white md:rounded-2xl md:border md:border-[#E2E8F0] md:shadow-[0_1px_2px_lab(34.0831_-9.57756_-27.7093_/_0.04),0_2px_12px_lab(34.0831_-9.57756_-27.7093_/_0.05)] md:p-1 md:mb-3">
            <div className="flex-1 min-w-0 md:flex-1 md:p-3">
              <Label className="text-[10px] text-muted-foreground mb-1 block md:text-[10px] md:font-bold md:text-muted-foreground md:uppercase md:tracking-[0.14em]">From</Label>
              <CountryCombobox value={selectedOrigin} onValueChange={handleOriginChange} />
            </div>
            <div className="flex shrink-0 pb-[10px] text-muted-foreground md:flex md:items-center md:px-3 md:pb-0 md:text-[#F2A123]" aria-hidden>
              <ArrowRight className="w-5 h-5" />
            </div>
            <div className="flex-1 min-w-0 md:flex-1 md:p-3">
              <Label className="text-[10px] text-muted-foreground mb-1 block md:text-[10px] md:font-bold md:text-muted-foreground md:uppercase md:tracking-[0.14em]">To</Label>
              <CountryCombobox value={selectedDestination} onValueChange={handleDestinationChange} />
            </div>
          </div>

          {/* Desktop-only route preview chip */}
          <div className="hidden md:flex md:items-center md:gap-2 md:text-[11px] md:text-muted-foreground md:px-1">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#FFF6E5] text-[#F2A123] font-semibold tracking-[0.04em]">
              <span className="w-1.5 h-1.5 rounded-full bg-[#F2A123]" />
              {formatCountryDisplay(COUNTRY_MAP[selectedOrigin] ?? selectedOrigin)} → {formatCountryDisplay(COUNTRY_MAP[selectedDestination] ?? selectedDestination)}
            </span>
            <span>Express · door-to-door · customs handled</span>
          </div>
        </div>

        <div className="space-y-4">
          <div className="bg-card rounded-xl border border-border p-4 shadow-sm md:p-5 md:rounded-2xl md:border-[#E2E8F0] md:shadow-[0_1px_2px_lab(34.0831_-9.57756_-27.7093_/_0.04),0_2px_12px_lab(34.0831_-9.57756_-27.7093_/_0.05)]">
            <div className="flex items-center justify-between mb-3 md:mb-4">
              <Label className="text-sm font-semibold md:text-[13px] md:font-bold md:tracking-tight">Weight &amp; pieces</Label>
              <div className="flex bg-muted rounded-lg p-0.5">
                <button
                  onClick={() => setWeightUnit('lb')}
                  className={cn(
                    'px-3 py-1 text-xs font-medium rounded-md transition-colors',
                    weightUnit === 'lb' ? 'bg-white text-primary shadow-sm' : 'text-muted-foreground'
                  )}
                >
                  lb
                </button>
                <button
                  onClick={() => setWeightUnit('kg')}
                  className={cn(
                    'px-3 py-1 text-xs font-medium rounded-md transition-colors',
                    weightUnit === 'kg' ? 'bg-white text-primary shadow-sm' : 'text-muted-foreground'
                  )}
                >
                  kg
                </button>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 md:gap-4">
              <div>
                <Label className="text-[10px] text-muted-foreground md:text-[10px] md:font-bold md:uppercase md:tracking-[0.12em]">Weight ({weightUnit})</Label>
                <Input
                  type="number"
                  value={weight}
                  onChange={(e) => setWeight(e.target.value)}
                  placeholder="2"
                  className="h-11 mt-1 text-sm bg-muted/30 border-border rounded-xl md:h-12 md:text-base md:font-semibold md:tabular-nums"
                  step="0.1"
                  min="0.1"
                  data-testid="input-weight"
                />
              </div>
              <div>
                <Label className="text-[10px] text-muted-foreground md:text-[10px] md:font-bold md:uppercase md:tracking-[0.12em]">Pieces</Label>
                <Input
                  type="number"
                  value={pieces}
                  onChange={(e) => setPieces(e.target.value)}
                  placeholder="1"
                  className="h-11 mt-1 text-sm bg-muted/30 border-border rounded-xl md:h-12 md:text-base md:font-semibold md:tabular-nums"
                  min="1"
                  data-testid="input-pieces"
                />
              </div>
            </div>
          </div>

          {/* Optional pincodes */}
          <div className="bg-card rounded-xl border border-border p-4 shadow-sm md:p-5 md:rounded-2xl md:border-[#E2E8F0] md:shadow-[0_1px_2px_lab(34.0831_-9.57756_-27.7093_/_0.04),0_2px_12px_lab(34.0831_-9.57756_-27.7093_/_0.05)]">
            <div className="flex items-center gap-1.5 mb-3">
              <Info className="w-3.5 h-3.5 shrink-0 text-muted-foreground" aria-hidden />
              <p className="text-xs text-muted-foreground">
                Enter pincodes for more accurate rates (optional)
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3 md:gap-4">
              <div>
                <Label className="text-[10px] text-muted-foreground md:text-[10px] md:font-bold md:uppercase md:tracking-[0.12em]">
                  From Pincode
                </Label>
                <Input
                  type="text"
                  value={originPincode}
                  onChange={(e) => setOriginPincode(e.target.value)}
                  placeholder="e.g. 400001"
                  maxLength={10}
                  className="h-11 mt-1 text-sm bg-muted/30 border-border rounded-xl md:h-12"
                  data-testid="input-origin-pincode"
                />
              </div>
              <div>
                <Label className="text-[10px] text-muted-foreground md:text-[10px] md:font-bold md:uppercase md:tracking-[0.12em]">
                  To Pincode
                </Label>
                <Input
                  type="text"
                  value={destPincode}
                  onChange={(e) => setDestPincode(e.target.value)}
                  placeholder="e.g. 10001"
                  maxLength={10}
                  className="h-11 mt-1 text-sm bg-muted/30 border-border rounded-xl md:h-12"
                  data-testid="input-dest-pincode"
                />
              </div>
            </div>
          </div>

          {apiError && (
            <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-xl p-3">
              <AlertTriangle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-red-600">{apiError}</p>
            </div>
          )}

          <Button
            onClick={handleGetRates}
            disabled={rateMutation.isPending}
            className="w-full h-12 bg-primary hover:bg-primary/90 text-white text-sm font-semibold rounded-xl shadow-md disabled:opacity-70 mt-6 mb-4 md:h-12 md:text-sm md:rounded-xl md:mt-5 md:mb-2 md:bg-[lab(34.0831_-9.57756_-27.7093)] md:hover:bg-[#2F4468] md:shadow-[0_4px_14px_lab(34.0831_-9.57756_-27.7093_/_0.18)]"
            data-testid="button-get-rates"
          >
            {rateMutation.isPending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <>
                Get Rates
                <ArrowRight className="w-4 h-4 ml-1.5 hidden md:inline-block" />
              </>
            )}
          </Button>

          {/* Desktop-only tip footer */}
          <p className="hidden md:block md:text-[11px] md:text-muted-foreground md:leading-relaxed md:text-center md:mt-2">
            Rates include GST and fuel surcharge. Final charges may vary based on actual weight and dimensions at pickup.
          </p>
        </div>
      </main>

      <BottomNav />
    </div>
  );
}

