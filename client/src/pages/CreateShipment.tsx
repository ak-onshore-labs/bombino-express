import { useState, useEffect, useCallback, useMemo, useLayoutEffect, useRef, type CSSProperties } from 'react';
import confetti from 'canvas-confetti';
import {
  ArrowLeft,
  Check,
  Package,
  User,
  MapPin,
  Send,
  ArrowRight,
  Loader2,
  AlertTriangle,
  FileText,
  Copy,
  Zap,
  ChevronDown,
  Info,
  X,
  CalendarIcon,
} from 'lucide-react';
import { format } from 'date-fns';
import { useLocation } from 'wouter';
import { useMutation } from '@tanstack/react-query';
import { BottomNav } from '@/components/BottomNav';
import { CorridorRouteInfo } from '@/components/CorridorRouteInfo';
import { AddressPicker, type SavedAddress } from '@/components/AddressPicker';
import { KycUpload, type KycUploadResult } from '@/components/KycUpload';
import { KycOnFileCard } from '@/components/KycOnFileCard';
import { useKycOnFile } from '@/hooks/useKycOnFile';
import { ShipmentContentSearch } from '@/components/ShipmentContentSearch';
import {
  DimensionPresetSheet,
  DIMENSION_PRESETS,
  type PresetId,
} from '@/components/DimensionPresetSheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useAppStore } from '@/lib/store';
import { PICKUP_CUTOFF_HOUR, earliestPickupDate, todayInIst } from '@shared/istTime';
import { lbToKg, inToCm } from '@/lib/mockData';
import { apiRequest } from '@/lib/queryClient';
import { payForOrder } from '@/lib/razorpay';
import { PaymentTestModeSwitch } from '@/components/PaymentTestModeSwitch';
import { cn } from '@/lib/utils';
import { getHsnCode } from '@/lib/hsnData';
import { useToast } from '@/hooks/use-toast';
import { usePincodeLookup } from '@/hooks/usePincodeLookup';
import {
  ITD_COUNTRY_LIST,
  ITD_COUNTRY_MAP,
  getDestinationCurrency,
  formatCountryDisplay,
} from '@/lib/itdCountryData';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';

interface FreeFormLineItem {
  total: string;
  no_of_packages: string;
  box_no: string;
  rate: string;
  hscode: string;
  description: string;
  unit_of_measurement: string;
  unit_weight: string;
  igst_amount: string;
}

interface CreateShipmentPayload {
  is_csbv_shipment?: string;
  is_ecommerce?: string;
  is_scheme?: string;
  is_bond_ut?: string;
  dispatch_type?: string;
  lut_number?: string;
  lut_issue_from?: string;
  lut_issue_till?: string;
  product_code: string;
  destination_code: string;
  booking_date: string;
  booking_time: string;
  pcs: string;
  shipment_value: string;
  shipment_value_currency: string;
  actual_weight: string;
  shipment_invoice_no: string;
  shipment_invoice_date: string;
  shipment_content: string;
  new_docket_free_form_invoice?: string;
  free_form_invoice_type_id?: string;
  free_form_currency?: string;
  terms_of_trade?: string;
  entry_type?: number;
  api_service_code: string;
  shipper_name: string;
  shipper_company_name: string;
  shipper_contact_no: string;
  shipper_email: string;
  shipper_address_line_1: string;
  shipper_city: string;
  shipper_state: string;
  shipper_country: string;
  shipper_zip_code: string;
  shipper_gstin_type?: string;
  shipper_gstin_no?: string;
  consignee_name: string;
  consignee_company_name: string;
  consignee_contact_no: string;
  consignee_email: string;
  consignee_address_line_1: string;
  consignee_city: string;
  consignee_state: string;
  consignee_country: string;
  consignee_zip_code: string;
  docket_items: { actual_weight: string; length: string; width: string; height: string; number_of_boxes: string }[];
  free_form_line_items?: FreeFormLineItem[];
  kyc_details?: Array<{
    document_type: string;
    document_no: string;
    document_sub_type: string;
    document_name: string;
    file_path: string;
  }>;
}

interface OrderCreatePayload {
  pickup_request: 1 | 2;
  pickup_date?: string | null;
  payment_method: 'pay_now' | 'pay_at_pickup' | 'pay_at_dropoff' | 'cod';
  booked_weight?: number | null;
  quoted_amount?: number | null;
  /** The customer wants us to pack the parcel. Never priced at booking. */
  packaging_required: boolean;
  origin_address: {
    full_name: string;
    company?: string | null;
    email?: string | null;
    phone: string;
    address_line_1: string;
    city: string;
    state?: string | null;
    pincode?: string | null;
    country_code: string;
    country_name?: string | null;
  };
  consignee: Record<string, unknown>;
  items: Record<string, unknown>;
}

interface OrderCreateResponse {
  order: {
    id: string;
    order_no: string;
  };
  message?: string;
}

interface RateParams {
  product_code: string;
  destination_code: string;
  booking_date: string;
  origin_code: string;
  pcs: string;
  actual_weight: string;
  ori_city?: string;
  ori_pincode?: string;
  dest_city?: string;
  dest_pincode?: string;
}

interface ITDChargeApplyEntry {
  name: string;
  amount: number;
}

interface ITDRateRow {
  id: string;
  code: string;
  rate: number;
  fsc: number;
  cgst: number;
  sgst: number;
  other_charges: number;
  chrage_apply_data?: Record<string, ITDChargeApplyEntry>;
  sub_total: number;
  total: number;
  per_kg: number;
  weight: string;
  gst_per: string;
  internal_api_service_code?: string;
}

interface ITDRateResponse {
  success?: boolean;
  data?: ITDRateRow[];
}

const BOMBINO_BLUE = '#14567C';
const BEST_GREEN = '#166534';
const BEST_BADGE_BG = '#dcfce7';

const ratesResultsShellStyle = {
  '--color-background-primary': '#ffffff',
  '--color-background-secondary': 'rgb(247 247 249)',
  '--color-border-tertiary': 'rgba(55, 65, 81, 0.12)',
} as CSSProperties;

/** Indian Rupee with sensible fraction digits (no float noise). */
function formatInr(n: number): string {
  return `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

function normalizeRateRow(raw: unknown): ITDRateRow | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const id = r.id != null ? String(r.id) : '';
  const code =
    typeof r.code === 'string'
      ? r.code
      : typeof r.internal_api_service_code === 'string'
        ? r.internal_api_service_code
        : '';
  if (!id && !code) return null;
  const num = (v: unknown): number => (typeof v === 'number' && !Number.isNaN(v) ? v : Number(v) || 0);
  const str = (v: unknown): string => (typeof v === 'string' ? v : String(v ?? ''));
  let chrage = r.chrage_apply_data;
  if (chrage && typeof chrage === 'object' && !Array.isArray(chrage)) {
    chrage = chrage as Record<string, ITDChargeApplyEntry>;
  } else {
    chrage = undefined;
  }
  return {
    id: id || code,
    code: code || id,
    rate: num(r.rate),
    fsc: num(r.fsc),
    cgst: num(r.cgst),
    sgst: num(r.sgst),
    other_charges: num(r.other_charges),
    chrage_apply_data: chrage as ITDRateRow['chrage_apply_data'],
    sub_total: num(r.sub_total),
    total: num(r.total),
    per_kg: num(r.per_kg),
    weight: str(r.weight),
    gst_per: str(r.gst_per),
    internal_api_service_code:
      typeof r.internal_api_service_code === 'string' ? r.internal_api_service_code : undefined,
  };
}

function dedupeAndSort(rows: ITDRateRow[]): ITDRateRow[] {
  const seen = new Set<string>();
  const deduped: ITDRateRow[] = [];
  for (const row of rows) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    deduped.push(row);
  }
  return [...deduped].sort((a, b) => a.total - b.total);
}

function itemizedChargesEmpty(service: ITDRateRow): boolean {
  const d = service.chrage_apply_data;
  return !d || Object.keys(d).length === 0;
}

const steps = [
  { id: 1, title: 'Sender', icon: User },
  { id: 2, title: 'Receiver', icon: MapPin },
  { id: 3, title: 'Package', icon: Package },
  { id: 4, title: 'Invoice', icon: FileText },
];

interface CountryComboboxProps {
  value: string;
  onValueChange: (code: string) => void;
}

function CountryCombobox({ value, onValueChange }: CountryComboboxProps) {
  const [open, setOpen] = useState(false);
  const country = ITD_COUNTRY_MAP[value];
  const displayName = country ? formatCountryDisplay(country.name) : value;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full h-11 justify-between font-normal text-sm bg-muted/30 border-border rounded-xl px-3"
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
              {ITD_COUNTRY_LIST.filter((c) => c.code !== 'IN').map((c) => (
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

function getDispatchType(serviceCode: string): string | undefined {
  const code = serviceCode.toLowerCase();
  if (code.includes('bms') || code.includes('bombino')) {
    return 'Postal';
  }
  return undefined;
}

/**
 * The product type each box size settles.
 *
 * A preset is a declaration of what is being sent, not only how big it is:
 * choosing the envelope says "paper", choosing a parcel size says "goods". So
 * the size answers the product-type question and the select is locked to the
 * answer. Keyed by `PresetId`, so a new preset will not compile until it says
 * which type it means.
 */
const PRESET_PRODUCT_TYPE: Record<PresetId, string> = {
  envelope: 'DOX',
  small: 'SPX',
  medium: 'SPX',
  large: 'SPX',
};

/** The select's label for each product type. The info sheet adds the code. */
const PRODUCT_TYPE_LABEL: Record<string, string> = {
  DOX: 'Documents',
  SPX: 'Package',
  COMMERCIAL: 'Commercial',
  'CSB V': 'CSB V',
};

/**
 * What each product type means, for the info sheet.
 *
 * Keyed by the same value the select carries, so the sheet explains exactly
 * the options on offer and no others — a personal customer reading about CSB V
 * is reading about a filing they cannot make.
 */
const PRODUCT_TYPE_INFO: Record<string, { title: string; body: string }> = {
  DOX: {
    title: 'Documents (DOX)',
    body: 'Standard industry code for shipments containing only paper — no commercial value, no duties.',
  },
  SPX: {
    title: 'Package (SPX)',
    body: "Small Parcel Express — usually containing physical goods that aren't just paper.",
  },
  COMMERCIAL: {
    title: 'Commercial',
    body: 'Goods meant for sale or trade. Requires a formal invoice and duty assessment.',
  },
  'CSB V': {
    title: 'CSB V',
    body: 'Courier Shipping Bill V — a simplified export process for low-value goods usually under ₹5,00,000 sent via courier.',
  },
};

export default function CreateShipment() {
  const [, setLocation] = useLocation();
  const { isLoggedIn, user, logout } = useAppStore();
  const [currentStep, setCurrentStep] = useState(1);
  const [newOrderNo, setNewOrderNo] = useState('');
  const [newOrderId, setNewOrderId] = useState('');
  const [submitError, setSubmitError] = useState('');

  // Pay-now only. The order exists either way by the time this matters — the
  // booking is never held hostage to the gateway — so `unpaid` is a normal
  // resting state the customer can leave and come back to, not an error.
  const [payStatus, setPayStatus] = useState<
    'none' | 'paying' | 'paid' | 'pending' | 'unpaid'
  >('none');
  const [payMessage, setPayMessage] = useState('');

  const [pickupRequest, setPickupRequest] = useState<'1' | '2'>('1');
  const [pickupDate, setPickupDate] = useState('');

  // ── Pickup cutoff ──────────────────────────────────────────────────────
  // Bookings taken after 3 PM IST are collected the next day at the earliest:
  // ops routes the afternoon's work before then, and a pickup accepted at 4 PM
  // is one nobody can reach. Recomputed on render rather than on a timer — a
  // form open across the cutoff is caught by the effect below on the next
  // render, and by `POST /api/orders` regardless.
  const earliestDate = earliestPickupDate();
  const cutoffPassed = earliestDate !== todayInIst();

  // A date chosen before the cutoff, submitted after it. Clear it rather than
  // letting the customer submit into a 409 they did nothing to cause.
  useEffect(() => {
    if (pickupDate && pickupDate < earliestDate) setPickupDate('');
  }, [pickupDate, earliestDate]);
  const [paymentMethod, setPaymentMethod] = useState('');
  const [pickupDatePickerOpen, setPickupDatePickerOpen] = useState(false);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [paymentError, setPaymentError] = useState('');
  const pendingOrderRef = useRef<Omit<OrderCreatePayload, 'payment_method'> | null>(null);

  const [senderName, setSenderName] = useState(isLoggedIn ? user?.fullName ?? '' : '');
  const [senderEmail, setSenderEmail] = useState(isLoggedIn ? user?.email ?? '' : '');
  const [senderPhone, setSenderPhone] = useState('');
  const [senderCompany, setSenderCompany] = useState('');
  const [senderCity, setSenderCity] = useState('');
  const [senderState, setSenderState] = useState('');
  const [senderZip, setSenderZip] = useState('');
  const [senderAddress, setSenderAddress] = useState('');

  const [receiverName, setReceiverName] = useState('');
  const [receiverPhone, setReceiverPhone] = useState('');
  const [receiverEmail, setReceiverEmail] = useState('');
  const [receiverCompany, setReceiverCompany] = useState('');
  const [receiverCity, setReceiverCity] = useState('');
  const [receiverState, setReceiverState] = useState('');
  const [receiverZip, setReceiverZip] = useState('');
  const [receiverAddress, setReceiverAddress] = useState('');

  const [destinationCountry, setDestinationCountry] = useState('US');
  const [selectedCurrency, setSelectedCurrency] = useState('USD');

  const [weightUnit, setWeightUnit] = useState<'lb' | 'kg'>('lb');
  const [weight, setWeight] = useState('2');
  const [pieces, setPieces] = useState('1');
  const [packagingRequired, setPackagingRequired] = useState(false);
  const [dimUnit, setDimUnit] = useState<'in' | 'cm'>('in');
  const [dimL, setDimL] = useState('');
  const [dimW, setDimW] = useState('');
  const [dimH, setDimH] = useState('');
  const [shipmentValue, setShipmentValue] = useState('');
  const [shipmentContent, setShipmentContent] = useState('');
  const [hsCode, setHsCode] = useState('');

  const [invoiceQty, setInvoiceQty] = useState('1');
  const [invoiceUnitWeight, setInvoiceUnitWeight] = useState('');
  const [invoiceUnitRate, setInvoiceUnitRate] = useState('');
  type CsbvDispatchType = 'Fine Jewellery' | 'Stones' | 'BPN Service' | 'Postal';

  const [csbvHsCode, setCsbvHsCode] = useState('');
  const [csbvEcommerce, setCsbvEcommerce] = useState<'yes' | 'no'>('no');
  const [csbvScheme, setCsbvScheme] = useState<'yes' | 'no'>('no');
  const [csbvBondType, setCsbvBondType] = useState<'igst' | 'bond_ut'>('igst');
  const [csbvIgstAmount, setCsbvIgstAmount] = useState('');
  const [csbvLutNumber, setCsbvLutNumber] = useState('');
  const [csbvLutFrom, setCsbvLutFrom] = useState('');
  const [csbvLutTill, setCsbvLutTill] = useState('');
  const [csbvDispatchType, setCsbvDispatchType] =
    useState<CsbvDispatchType>('Postal');
  const [productType, setProductType] = useState('');
  const [showProductTypeInfo, setShowProductTypeInfo] = useState(false);
  const [showPresetSheet, setShowPresetSheet] = useState(false);
  const [selectedPreset, setSelectedPreset] = useState<PresetId | null>(null);

  const [rateResults, setRateResults] = useState<ITDRateRow[] | null>(null);
  const [selectedService, setSelectedService] = useState<ITDRateRow | null>(null);
  const [ratesError, setRatesError] = useState('');
  const [serviceSelectionError, setServiceSelectionError] = useState('');
  const [expandedById, setExpandedById] = useState<Record<string, boolean>>({});
  const [showServiceModal, setShowServiceModal] = useState(false);
  const [pendingService, setPendingService] = useState<ITDRateRow | null>(null);

  const [kycResult, setKycResult] = useState<KycUploadResult | null>(null);

  const { data: kycOnFile } = useKycOnFile({ enabled: isLoggedIn });

  // Company accounts are identified by GST at signup and never hold a KYC
  // document, so gating booking on one locked them out of the flow entirely.
  // Undefined account_type (legacy ITD logins, pre-existing localStorage
  // sessions) falls through to the personal path — the stricter of the two.
  const isCompanyAccount = user?.account_type === 'company';
  const kycRequired = !isCompanyAccount;

  // Personal customers with a document already on file are not re-prompted;
  // they can opt into replacing it.
  const [showKycUpdate, setShowKycUpdate] = useState(false);

  // ── Product Type ───────────────────────────────────────────────────────
  // Partitioned by account type, because the two halves are different customs
  // regimes rather than different sizes of the same thing: a personal customer
  // sends documents or a package, a company files a commercial invoice or a
  // CSB V courier shipping bill. Offering all four to everyone was offering
  // most customers a filing they cannot make.
  //
  // Packaging does NOT narrow this list. It reads as though it should — an
  // already-packed parcel sounds like "document or package" — but that is the
  // personal list restated, and applying it to a company account would leave
  // no valid option at all.
  const presetProductType = selectedPreset ? PRESET_PRODUCT_TYPE[selectedPreset] : null;

  const productTypeOptions = useMemo(() => {
    const values = isCompanyAccount ? ['COMMERCIAL', 'CSB V'] : ['DOX', 'SPX'];
    const base = values.map((value) => ({ value, label: PRODUCT_TYPE_LABEL[value] ?? value }));

    // A preset settles the question by itself, so the type it implies is added
    // for a company account, which carries neither DOX nor SPX otherwise. The
    // select is locked in that state, so this only ever renders the one value.
    if (presetProductType && !base.some((o) => o.value === presetProductType)) {
      const label = PRODUCT_TYPE_LABEL[presetProductType] ?? presetProductType;
      return [{ value: presetProductType, label }, ...base];
    }
    return base;
  }, [isCompanyAccount, presetProductType]);

  /** Choosing a box size IS the product-type answer, so the select is locked. */
  const productTypeLocked = presetProductType !== null;

  // ── Payment methods ────────────────────────────────────────────────────
  // Two of the four are tied to how the parcel reaches us, and offering the
  // wrong one strands the money: pay-at-pickup is collected by the agent at
  // the door, so it cannot exist on a drop-off; pay-at-drop-off is collected
  // by ops at the hub counter, so it cannot exist on a pickup. `POST
  // /api/orders` enforces the same pairing — this only stops the customer
  // choosing something that would be rejected.
  const paymentMethodOptions = useMemo(() => {
    const isPickup = pickupRequest === '1';
    return [
      ['pay_now', 'Pay Now'],
      ...(isPickup
        ? ([['pay_at_pickup', 'Pay at Pickup']] as const)
        : ([['pay_at_dropoff', 'Pay at Drop-off']] as const)),
      ['cod', 'Cash on Delivery'],
    ] as ReadonlyArray<readonly [string, string]>;
  }, [pickupRequest]);

  // Switching between pickup and drop-off can invalidate an already-chosen
  // method. Clear it rather than carrying a selection the server will refuse.
  useEffect(() => {
    if (!paymentMethod) return;
    if (!paymentMethodOptions.some(([val]) => val === paymentMethod)) {
      setPaymentMethod('');
    }
  }, [paymentMethodOptions, paymentMethod]);

  const [stepError, setStepError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, boolean>>({});

  const { hint: senderPincodeHint, lookup: lookupSenderPincode } = usePincodeLookup();
  const { hint: receiverPincodeHint, lookup: lookupReceiverPincode } = usePincodeLookup();

  const clearFieldError = (key: string) => {
    setFieldErrors((prev) => {
      if (!prev[key]) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  const fieldBorderClass = (key: string) =>
    cn(
      'h-11 mt-1 text-sm bg-muted/30 border-border rounded-xl',
      // `field-shake` is both the animation and the marker `scrollToFirstError`
      // queries, so any field that can turn red is automatically findable. Add
      // it wherever a component styles its own invalid state (see KycUpload).
      fieldErrors[key] && 'border-2 border-primary field-shake'
    );

  /**
   * Take the customer to the first field they missed.
   *
   * A step can be taller than the viewport, so marking a field red off-screen
   * tells nobody anything: the Continue button simply stops working. This
   * scrolls the topmost invalid field into view and replays the shake.
   *
   * Runs after paint, because the elements it looks for do not carry the class
   * until React has committed the new `fieldErrors`. The animation is restarted
   * by hand — the class is already on the element after a second failed
   * attempt, and CSS will not re-run an animation that never stopped.
   */
  const scrollToFirstError = () => {
    requestAnimationFrame(() => {
      const marked = Array.from(document.querySelectorAll<HTMLElement>('.field-shake'));
      if (marked.length === 0) return;

      for (const el of marked) {
        el.style.animation = 'none';
        void el.offsetHeight; // reflow, so the restart below is a real restart
        el.style.animation = '';
      }

      // `querySelectorAll` returns document order, which on a single-column
      // form is visual order, so the first match is the topmost field.
      marked[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  };

  const { toast } = useToast();

  useEffect(() => {
    setRateResults(null);
    setSelectedService(null);
    setRatesError('');
    setServiceSelectionError('');
    const destCurrency = getDestinationCurrency(destinationCountry);
    setSelectedCurrency(destCurrency == null || destCurrency === 'INR' ? 'INR' : destCurrency);
  }, [destinationCountry]);

  useEffect(() => {
    if (!newOrderNo) return;
    confetti({
      particleCount: 120,
      spread: 70,
      origin: { x: 0.5, y: 0.5 },
      startVelocity: 40,
      colors: ['#14567C', '#ffffff'],
    });
  }, [newOrderNo]);

  // ── Steps and the back button ──────────────────────────────────────────
  // The four steps are local state, not routes, so without this the browser
  // and Android back button leave the booking entirely: a customer correcting
  // an address on step 3 lands on Home with everything they typed gone.
  //
  // Each step forward pushes a history entry tagged with its number, so back
  // pops to the previous step instead. The URL never changes — these are steps
  // in one screen, not four addresses, and a shareable /create-shipment?step=3
  // would promise a resumable state that does not exist.

  /** Latest values for the popstate listener, which is bound once on mount. */
  const currentStepRef = useRef(currentStep);
  currentStepRef.current = currentStep;
  const newOrderNoRef = useRef(newOrderNo);
  newOrderNoRef.current = newOrderNo;
  const setLocationRef = useRef(setLocation);
  setLocationRef.current = setLocation;

  const goToStep = (step: number) => {
    window.history.pushState({ ...window.history.state, bombinoStep: step }, '');
    setCurrentStep(step);
  };

  // Tag the entry the customer arrived on, so a back press from step 2 lands
  // on a marked step-1 entry rather than an anonymous one this cannot tell
  // apart from the page they came from. Mount only: re-running it while the
  // customer is on step 3 would relabel that entry as step 1.
  useEffect(() => {
    window.history.replaceState({ ...window.history.state, bombinoStep: 1 }, '');
  }, []);

  useEffect(() => {
    const onPopState = (event: PopStateEvent) => {
      // Booked. Back means "leave", not "edit the order I just placed" — the
      // form behind the success screen is a shipment that already exists.
      if (newOrderNoRef.current) {
        setLocationRef.current('/home');
        return;
      }

      const step = (event.state as { bombinoStep?: number } | null)?.bombinoStep;
      // No tag means the entry predates this screen, so the customer is
      // leaving. Wouter has already handled it; nothing to do here.
      if (typeof step !== 'number' || step === currentStepRef.current) return;

      setFieldErrors({});
      setStepError('');
      setCurrentStep(step);
    };

    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  /**
   * Set the product type and drop everything derived from the old one.
   *
   * Rates are quoted per product type and the CSB V fields belong to CSB V
   * alone, so both must go with it. Shared by the select and by the effect
   * below, which would otherwise leave a stale quote attached to a type the
   * customer never picked.
   */
  const applyProductType = useCallback((value: string) => {
    setProductType(value);
    // Answering the field clears its mark; otherwise the select stays red and
    // shakes again on the next submit even though it is now filled in.
    setFieldErrors((prev) => {
      if (!prev.productType) return prev;
      const next = { ...prev };
      delete next.productType;
      return next;
    });
    setRateResults(null);
    setSelectedService(null);
    setRatesError('');
    setServiceSelectionError('');
    if (value !== 'CSB V') {
      setCsbvHsCode('');
      setCsbvEcommerce('no');
      setCsbvScheme('no');
      setCsbvBondType('igst');
      setCsbvIgstAmount('');
      setCsbvLutNumber('');
      setCsbvLutFrom('');
      setCsbvLutTill('');
      setCsbvDispatchType('Postal');
    }
  }, []);

  // Keep the chosen type inside what is on offer. A preset forces its own
  // type; dropping a preset that had forced one leaves the field empty rather
  // than holding a value the customer never chose from the list they can see.
  useEffect(() => {
    if (presetProductType) {
      if (productType !== presetProductType) applyProductType(presetProductType);
      return;
    }
    if (productType && !productTypeOptions.some((o) => o.value === productType)) {
      applyProductType('');
    }
  }, [presetProductType, productTypeOptions, productType, applyProductType]);

  useEffect(() => {
    if (!selectedPreset) return;
    const preset = DIMENSION_PRESETS.find((p) => p.id === selectedPreset);
    if (!preset) return;
    const vals = dimUnit === 'cm' ? preset.cm : preset.in;
    setDimL(vals.l);
    setDimW(vals.w);
    setDimH(vals.h);
  }, [dimUnit, selectedPreset]);

  /**
   * Open Razorpay for an order that already exists.
   *
   * Called straight after booking, and again from the success screen if the
   * customer dismissed the modal. Never blocks the order: whatever happens
   * here, the parcel is booked and the money can be settled later.
   */
  const runCheckout = async (orderId: string): Promise<void> => {
    setPayStatus('paying');
    setPayMessage('');

    const outcome = await payForOrder(orderId);

    if (outcome.status === 'paid') {
      setPayStatus('paid');
      toast({ title: 'Payment successful', description: 'Your order is paid.' });
      return;
    }

    if (outcome.status === 'pending') {
      // The charge is probably real and the webhook will confirm it. Saying
      // "unpaid" here would invite a second payment for the same order.
      setPayStatus('pending');
      setPayMessage(outcome.message);
      return;
    }

    setPayStatus('unpaid');
    setPayMessage(outcome.status === 'failed' ? outcome.message : '');
  };

  const createMutation = useMutation({
    mutationFn: (payload: OrderCreatePayload) =>
      apiRequest('POST', '/api/orders', payload).then((r) => r.json() as Promise<OrderCreateResponse>),
    onSuccess: (data) => {
      setShowConfirmModal(false);
      setNewOrderNo(data.order.order_no);
      setNewOrderId(data.order.id);

      // Order first, money second — deliberately. Opening checkout before the
      // order exists would leave a paid customer with nothing to attach the
      // payment to if the booking then failed.
      if (paymentMethod === 'pay_now') {
        void runCheckout(data.order.id);
      }
    },
    onError: (err) => {
      const message = err instanceof Error ? err.message : 'Order creation failed';

      // A 401 is handled centrally — the interceptor in lib/session.ts has
      // already cleared the session and started the redirect by the time this
      // runs. Only close the modal so the expiry notice is not behind it.
      if (err instanceof Error && /^401:/.test(err.message)) {
        setShowConfirmModal(false);
        return;
      }

      // All other errors — keep the modal open so the user can retry
      const msg = message.replace(/^\d+:\s*/, '');
      setPaymentError(msg);
    },
  });

  const rateMutation = useMutation({
    mutationFn: (params: RateParams) =>
      apiRequest('POST', '/api/rates', params).then((r) => r.json() as Promise<ITDRateResponse>),
    onMutate: () => {
      setSelectedService(null);
      setRateResults(null);
      setRatesError('');
      setServiceSelectionError('');
    },
    onSuccess: (data) => {
      const rawList: unknown[] = Array.isArray(data)
        ? (data as unknown[])
        : Array.isArray(data?.data)
          ? (data.data as unknown[])
          : [];
      const services: ITDRateRow[] = rawList
        .map((item) => normalizeRateRow(item))
        .filter((row): row is ITDRateRow => row !== null);
      setRateResults(services);
      setPendingService(null);
      setShowServiceModal(true);
    },
    onError: (err) => {
      setRateResults(null);
      const msg = err instanceof Error ? err.message.replace(/^\d+:\s*/, '') : 'Rate calculation failed';
      setRatesError(msg);
    },
  });

  const displayRates = useMemo(() => {
    if (!rateResults?.length) return [];
    return dedupeAndSort(rateResults);
  }, [rateResults]);

  useLayoutEffect(() => {
    if (displayRates.length === 0) return;
    const bestId = displayRates[0].id;
    setExpandedById({ [bestId]: true });
  }, [displayRates]);

  const handleGetRates = (): void => {
    if (!productType.trim()) return;
    setRatesError('');
    const w = parseFloat(weight) || 1;
    const weightKg = weightUnit === 'kg' ? w : lbToKg(w);
    rateMutation.mutate({
      product_code: productType,
      destination_code: destinationCountry,
      booking_date: new Date().toISOString().split('T')[0],
      origin_code: 'IN',
      pcs: String(parseInt(pieces) || 1),
      actual_weight: String(weightKg.toFixed(2)),
      ori_city: senderCity.toUpperCase(),
      ori_pincode: senderZip,
      dest_city: receiverCity.toUpperCase(),
      dest_pincode: receiverZip,
    });
  };

  const handleOpenServiceModal = (): void => {
    if (rateResults === null) {
      handleGetRates();
      return;
    }
    setPendingService(selectedService);
    setShowServiceModal(true);
  };

  if (!isLoggedIn) {
    return (
      <div className="min-h-[100dvh] bg-background pb-nav" data-testid="screen-create-login-required">
        <header className="sticky top-0 z-50 bg-white border-b border-[#E2E8F0] safe-top md:hidden">
          <div className="flex items-center h-14 px-4 max-w-md mx-auto">
            <button
              onClick={() => setLocation('/home')}
              className="p-2 -ml-2 rounded-lg hover:bg-muted transition-colors"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <h1 className="ml-2 font-semibold text-sm">Ship</h1>
          </div>
        </header>

        <main className="flex flex-col items-center justify-center min-h-[60vh] max-w-md mx-auto px-4 text-center">
          <div className="w-16 h-16 bg-[lab(34.0831_-9.57756_-27.7093)]/8 rounded-full flex items-center justify-center mx-auto mb-4">
            <Send className="w-8 h-8 text-[lab(34.0831_-9.57756_-27.7093)]" />
          </div>
          <h2 className="text-lg font-semibold text-[lab(34.0831_-9.57756_-27.7093)] mb-2">Please login to continue</h2>
          <p className="text-sm text-muted-foreground mb-6">
            Sign in to create and manage your shipments
          </p>
          <Button
            onClick={() => setLocation('/login?redirect=/create')}
            className="bg-[#F2A123] hover:bg-[#F2A123]/90 text-[lab(34.0831_-9.57756_-27.7093)] font-semibold h-12 px-8 rounded-xl shadow-[0_4px_20px_oklch(17%_0.048_248_/_0.10)]"
            data-testid="button-login-to-create"
          >
            Login
          </Button>
        </main>

        <BottomNav />
      </div>
    );
  }

  if (newOrderNo) {
    const bookingDateLabel = new Date().toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
    const corridorLabel = `${senderCity}, ${senderState} → ${receiverCity}, ${receiverState}`;

    const copyOrderNo = (): void => {
      void navigator.clipboard.writeText(newOrderNo).then(() => {
        toast({ title: 'Copied', description: 'Order ID copied to clipboard' });
      });
    };

    return (
      <div className="min-h-[100dvh] bg-background pb-nav" data-testid="screen-create-success">
        <main className="px-4 py-12 max-w-md mx-auto text-center">
          <div className="w-20 h-20 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-5 animate-scale-in">
            <Check className="w-10 h-10 text-[#14567C]" strokeWidth={2.5} />
          </div>
          <h2 className="text-2xl font-bold text-foreground mb-2">Order Placed!</h2>
          <p className="text-sm text-muted-foreground mb-6">
            {pickupRequest === '1'
              ? "We'll pick up your parcel in the slot you chose."
              : 'Drop your parcel off whenever suits you.'}
          </p>

          <div className="bg-card rounded-xl border border-border p-4 mb-6 text-left shadow-sm w-full">
            <button
              type="button"
              onClick={copyOrderNo}
              className="w-full text-left rounded-lg p-2 -m-2 hover:bg-muted/50 transition-colors active:scale-[0.99]"
              data-testid="button-copy-order-no"
            >
              <p className="text-xs text-muted-foreground mb-1">Order ID · tap to copy</p>
              <div className="flex items-center justify-between gap-2">
                <p className="text-lg font-bold text-foreground break-all">{newOrderNo}</p>
                <Copy className="w-5 h-5 shrink-0 text-muted-foreground" aria-hidden />
              </div>
            </button>

            <div className="mt-4 pt-4 border-t border-border space-y-3 text-sm">
              <div className="flex justify-between gap-3">
                <span className="text-muted-foreground shrink-0">Service</span>
                <span className="font-medium text-foreground text-right text-xs break-words">
                  {selectedService
                    ? selectedService.internal_api_service_code || selectedService.code
                    : '—'}
                </span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-muted-foreground shrink-0">Booking date</span>
                <span className="font-medium text-foreground text-right">{bookingDateLabel}</span>
              </div>
              {pickupRequest === '1' && (
                <div className="flex justify-between gap-3">
                  <span className="text-muted-foreground shrink-0">Pickup</span>
                  <span className="font-medium text-foreground text-right">
                    {pickupDate}
                  </span>
                </div>
              )}
              <div>
                <p className="text-muted-foreground text-xs mb-1">From → To</p>
                <p className="font-medium text-foreground text-sm leading-snug">{corridorLabel}</p>
              </div>
            </div>
          </div>

          {/* Pay-now only. Four states, because "we don't know yet" is a real
              one and rendering it as unpaid invites a duplicate payment. */}
          {payStatus !== 'none' && (
            <div
              className={cn(
                'rounded-xl border p-4 mb-4 text-left w-full',
                payStatus === 'paid' && 'border-emerald-200 bg-emerald-50',
                payStatus === 'pending' && 'border-amber-200 bg-amber-50',
                payStatus === 'unpaid' && 'border-amber-200 bg-amber-50',
                payStatus === 'paying' && 'border-border bg-muted/40'
              )}
              data-testid="panel-payment-status"
            >
              {payStatus === 'paying' && (
                <p className="text-sm text-muted-foreground flex items-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin shrink-0" />
                  Waiting for the payment window…
                </p>
              )}

              {payStatus === 'paid' && (
                <p className="text-sm font-medium text-emerald-800">
                  Payment received. Nothing further to pay right now.
                </p>
              )}

              {payStatus === 'pending' && (
                <p className="text-sm text-amber-900">
                  {payMessage || 'Payment received — confirming it now.'} Your order will update on
                  its own; please do not pay again.
                </p>
              )}

              {payStatus === 'unpaid' && (
                <>
                  <p className="text-sm font-medium text-amber-900">Payment not completed</p>
                  <p className="text-xs text-amber-900/80 mt-1 leading-relaxed">
                    {payMessage ||
                      'Your order is booked. You can pay now, or from the order any time before pickup.'}
                  </p>
                  <Button
                    onClick={() => void runCheckout(newOrderId)}
                    className="mt-3 w-full h-11 bg-primary hover:bg-primary/90 text-sm rounded-lg"
                    data-testid="button-retry-payment"
                  >
                    Pay now
                  </Button>
                </>
              )}
            </div>
          )}

          <div className="space-y-2">
            <Button
              onClick={() => setLocation('/orders')}
              className="w-full h-12 bg-primary hover:bg-primary/90 text-sm rounded-xl shadow-md flex items-center justify-center gap-2"
              data-testid="button-view-orders"
            >
              <FileText className="w-4 h-4" />
              Go to My Orders
            </Button>
            <Button
              variant="outline"
              onClick={() => setLocation('/home')}
              className="w-full h-12 text-sm rounded-xl border-border"
              data-testid="button-go-home"
            >
              Go Home
            </Button>
          </div>
        </main>

        <BottomNav />
      </div>
    );
  }

  const handleNext = () => {
    setStepError('');
    setFieldErrors({});
    if (currentStep === 1) {
      const e: Record<string, boolean> = {};
      if (!senderName.trim()) e.senderName = true;
      if (!/^\d{10}$/.test(senderPhone.trim())) e.senderPhone = true;
      if (!senderAddress.trim()) e.senderAddress = true;
      if (!senderCity.trim()) e.senderCity = true;
      if (!senderState.trim()) e.senderState = true;
      if (!senderZip.trim()) e.senderZip = true;
      if (kycRequired && !kycOnFile && !kycResult) e.kycMissing = true;
      if (pickupRequest === '1' && !pickupDate) e.pickupDate = true;
      if (Object.keys(e).length) {
        setFieldErrors(e);
        scrollToFirstError();
        return;
      }
    }
    if (currentStep === 2) {
      const e: Record<string, boolean> = {};
      if (!receiverName.trim()) e.receiverName = true;
      const phoneDigits = receiverPhone.replace(/\D/g, '');
      if (phoneDigits.length < 6 || phoneDigits.length > 15) e.receiverPhone = true;
      if (!receiverAddress.trim()) e.receiverAddress = true;
      if (!receiverCity.trim()) e.receiverCity = true;
      if (!receiverState.trim()) e.receiverState = true;
      if (!receiverZip.trim()) e.receiverZip = true;
      if (Object.keys(e).length) {
        setFieldErrors(e);
        scrollToFirstError();
        return;
      }
    }
    if (currentStep === 3) {
      const e: Record<string, boolean> = {};
      if (!weight || parseFloat(weight) <= 0) e.weight = true;
      if (!shipmentValue || parseFloat(shipmentValue) <= 0) e.shipmentValue = true;
      if (!shipmentContent.trim()) e.shipmentContent = true;
      if (!dimL.trim()) e.dimL = true;
      if (!dimW.trim()) e.dimW = true;
      if (!dimH.trim()) e.dimH = true;
      if (Object.keys(e).length) {
        setFieldErrors(e);
        scrollToFirstError();
        return;
      }
      const trimmedContent = shipmentContent.trim();
      setHsCode(trimmedContent ? (getHsnCode(trimmedContent) || '') : '');
    }
    if (currentStep < 4) goToStep(currentStep + 1);
  };

  /**
   * The in-app back arrow. Delegates to the browser rather than setting the
   * step directly, so one code path serves the arrow, the Android back
   * gesture, and the desktop back button — and the history stack cannot drift
   * out of step with what is on screen.
   */
  const handleBack = () => {
    if (currentStep > 1) {
      window.history.back();
      return;
    }
    setFieldErrors({});
    setStepError('');
    setLocation('/home');
  };

  const getWeightLb = (): number => {
    const w = parseFloat(weight) || 1;
    return weightUnit === 'lb' ? w : w / 0.453592;
  };

  const getWeightKg = (): number => {
    const w = parseFloat(weight) || 1;
    return weightUnit === 'kg' ? w : lbToKg(w);
  };

  const handleSubmit = () => {
    setSubmitError('');
    setServiceSelectionError('');
    setFieldErrors({});
    // Both of these are mandatory and neither is a text input, so they report
    // through their own error state rather than `fieldErrors`. They still get
    // taken to and shaken — a customer who missed the product type should not
    // have to hunt a step for it.
    if (!productType.trim()) {
      setSubmitError('Please select a product type');
      setFieldErrors({ productType: true });
      scrollToFirstError();
      return;
    }
    if (!selectedService) {
      setServiceSelectionError('Please select a shipping service');
      scrollToFirstError();
      return;
    }
    const invE: Record<string, boolean> = {};
    const qtyNum = parseInt(invoiceQty, 10);
    if (!invoiceQty.trim() || Number.isNaN(qtyNum) || qtyNum < 1) invE.invoiceQty = true;
    const uw = parseFloat(invoiceUnitWeight || '');
    if (!invoiceUnitWeight.trim() || Number.isNaN(uw) || uw <= 0) invE.invoiceUnitWeight = true;
    const ur = parseFloat(invoiceUnitRate || '');
    if (!invoiceUnitRate.trim() || Number.isNaN(ur) || ur <= 0) invE.invoiceUnitRate = true;
    if (Object.keys(invE).length) {
      setFieldErrors(invE);
      scrollToFirstError();
      return;
    }
    if (productType === 'CSB V') {
      const csbvE: Record<string, boolean> = {};

      if (csbvHsCode.length !== 10) {
        csbvE.csbvHsCode = true;
      }

      if (csbvBondType === 'igst') {
        const igstAmt = parseFloat(csbvIgstAmount);
        if (!csbvIgstAmount.trim() || Number.isNaN(igstAmt)) {
          csbvE.csbvIgstAmount = true;
        }
      } else {
        if (!csbvLutNumber.trim()) {
          csbvE.csbvLutNumber = true;
        }
        if (!csbvLutFrom.trim()) {
          csbvE.csbvLutFrom = true;
        }
        if (!csbvLutTill.trim()) {
          csbvE.csbvLutTill = true;
        }
      }

      if (Object.keys(csbvE).length) {
        setFieldErrors(csbvE);
        scrollToFirstError();
        return;
      }
    }
    if (pickupRequest === '1' && !pickupDate) {
      setSubmitError('Please go back to step 1 and choose a pickup date');
      return;
    }
    const weightLb = getWeightLb();
    const now = new Date();
    const todayStr = now.toISOString().split('T')[0];
    const timeStr = now.toTimeString().slice(0, 8); // HH:MM:SS

    const lengthVal = dimL ? (dimUnit === 'cm' ? String(parseFloat(dimL) / 2.54) : dimL) : '0';
    const widthVal = dimW ? (dimUnit === 'cm' ? String(parseFloat(dimW) / 2.54) : dimW) : '0';
    const heightVal = dimH ? (dimUnit === 'cm' ? String(parseFloat(dimH) / 2.54) : dimH) : '0';

    const qty = parseInt(invoiceQty) || 1;
    const rate = parseFloat(invoiceUnitRate) || 0;
    const total = (qty * rate).toFixed(2);

    const contentTrimmed = shipmentContent.trim();
    const lineHsCode = contentTrimmed ? (getHsnCode(contentTrimmed) || '') : '';

    const apiServiceCodeResolved =
      selectedService.internal_api_service_code || selectedService.code;

    const dispatchType =
      productType !== 'CSB V'
        ? getDispatchType(apiServiceCodeResolved)
        : undefined;

    const defaultLineItem: FreeFormLineItem = {
      total,
      no_of_packages: String(qty),
      box_no: '1',
      rate: String(rate),
      hscode: lineHsCode,
      description: contentTrimmed || 'GIFTS',
      unit_of_measurement: 'PCS',
      unit_weight: invoiceUnitWeight || '0.00',
      igst_amount: '0.00',
    };

    const freeFormLineItem: FreeFormLineItem =
      productType === 'CSB V'
        ? csbvBondType === 'igst'
          ? {
              ...defaultLineItem,
              hscode: csbvHsCode,
              igst_amount: csbvIgstAmount,
            }
          : {
              ...defaultLineItem,
              hscode: csbvHsCode,
            }
        : defaultLineItem;

    const payload: CreateShipmentPayload = {
      product_code: productType,
      destination_code: destinationCountry,
      booking_date: todayStr,
      booking_time: timeStr,
      pcs: String(parseInt(pieces) || 1),
      shipment_value: shipmentValue || '0',
      shipment_value_currency: selectedCurrency,
      actual_weight: String(weightLb.toFixed(2)),
      // TODO: shipment_invoice_no hardcoded — update when invoice numbering is implemented
      shipment_invoice_no: 'TESTINV01',
      shipment_invoice_date: todayStr,
      shipment_content: contentTrimmed || 'GIFTS',
      new_docket_free_form_invoice: '1',
      free_form_invoice_type_id: '1',
      free_form_currency: selectedCurrency,
      terms_of_trade: 'FOB',
      entry_type: 2,
      api_service_code: apiServiceCodeResolved,
      shipper_name: senderName,
      shipper_company_name: senderCompany || senderName,
      shipper_contact_no: senderPhone,
      shipper_email: senderEmail,
      shipper_address_line_1: senderAddress,
      shipper_city: senderCity,
      shipper_state: senderState,
      shipper_country: 'IN',
      shipper_zip_code: senderZip,
      consignee_name: receiverName,
      consignee_company_name: receiverCompany || receiverName,
      consignee_contact_no:
        ITD_COUNTRY_MAP[destinationCountry]?.dialCode
          ? `${ITD_COUNTRY_MAP[destinationCountry].dialCode}${receiverPhone}`
          : receiverPhone,
      consignee_email: receiverEmail || senderEmail,
      consignee_address_line_1: receiverAddress,
      consignee_city: receiverCity,
      consignee_state: receiverState,
      consignee_country: destinationCountry,
      consignee_zip_code: receiverZip,
      docket_items: [{
        actual_weight: String(weightLb.toFixed(2)),
        length: lengthVal,
        width: widthVal,
        height: heightVal,
        number_of_boxes: String(parseInt(pieces) || 1),
      }],
      free_form_line_items: [freeFormLineItem],
    };

    if (dispatchType !== undefined) {
      payload.dispatch_type = dispatchType;
    }

    if (productType === 'CSB V') {
      payload.is_csbv_shipment = 'true';
      payload.is_ecommerce = csbvEcommerce;
      payload.is_scheme = csbvScheme;
      payload.is_bond_ut = csbvBondType;
      payload.dispatch_type = csbvDispatchType;

      if (csbvBondType === 'bond_ut') {
        payload.lut_number = csbvLutNumber;
        payload.lut_issue_from = csbvLutFrom;
        payload.lut_issue_till = csbvLutTill;
      }
    }

    const weightKg = weightUnit === 'kg' ? (parseFloat(weight) || 1) : lbToKg(parseFloat(weight) || 1);
    const quotedAmount = selectedService ? selectedService.total : null;

    pendingOrderRef.current = {
      pickup_request: pickupRequest === '1' ? 1 : 2,
      pickup_date: pickupRequest === '1' ? pickupDate : null,
      booked_weight: Number.isFinite(weightKg) ? parseFloat(weightKg.toFixed(2)) : null,
      quoted_amount: quotedAmount != null && Number.isFinite(quotedAmount) ? quotedAmount : null,
      packaging_required: packagingRequired,
      origin_address: {
        full_name: senderName,
        company: senderCompany || null,
        email: senderEmail || null,
        phone: senderPhone,
        address_line_1: senderAddress,
        city: senderCity,
        state: senderState || null,
        pincode: senderZip || null,
        country_code: 'IN',
        country_name: 'India',
      },
      consignee: {
        name: receiverName,
        company: receiverCompany || null,
        email: receiverEmail || null,
        phone: payload.consignee_contact_no,
        address_line_1: receiverAddress,
        city: receiverCity,
        state: receiverState || null,
        pincode: receiverZip || null,
        country_code: destinationCountry,
        country_name: ITD_COUNTRY_MAP[destinationCountry]?.name ?? destinationCountry,
      },
      items: payload as unknown as Record<string, unknown>,
    };

    setPaymentError('');
    setShowConfirmModal(true);
  };

  const handleConfirmBooking = () => {
    if (!paymentMethod) {
      setPaymentError('Please select a payment method');
      return;
    }
    if (!pendingOrderRef.current) return;

    createMutation.mutate({
      ...pendingOrderRef.current,
      payment_method: paymentMethod as OrderCreatePayload['payment_method'],
    });
  };

  return (
    <div className="min-h-[100dvh] bg-background pb-nav" data-testid="screen-create">
      <header className="sticky top-0 z-50 bg-white border-b border-[#E2E8F0] safe-top md:hidden">
        <div className="flex items-center h-14 px-4 w-full max-w-6xl mx-auto md:px-6">
          <button
            onClick={handleBack}
            className="p-2 -ml-2 rounded-lg hover:bg-muted transition-colors"
            data-testid="button-back-create"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h1 className="ml-2 font-semibold text-sm">Create Shipment</h1>
        </div>
      </header>

      {/* Desktop title bar — Booking eyebrow + H1 + segmented stepper */}
      <div className="hidden md:block bg-background border-b border-[#E2E8F0]/60">
        <div className="w-full max-w-6xl mx-auto px-4 md:px-6 pt-6 pb-5">
          <div className="flex items-start justify-between gap-6 flex-wrap">
            <div className="min-w-0">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-[10px] font-bold tracking-[0.18em] uppercase text-[#F2A123]">Booking</span>
                <span className="h-px w-24 bg-gradient-to-r from-[#F2A123]/30 to-transparent" aria-hidden />
              </div>
              <h1 className="text-[26px] font-bold tracking-[-0.02em] text-[lab(34.0831_-9.57756_-27.7093)] leading-tight">Create shipment</h1>
              <p className="text-sm text-muted-foreground mt-1">
                Step <span className="text-[lab(34.0831_-9.57756_-27.7093)] font-semibold tabular-nums">{currentStep < 4 ? currentStep : steps.length}</span> of <span className="tabular-nums">{steps.length}</span> · {steps[Math.min(currentStep, steps.length) - 1]?.title}
              </p>
            </div>

            {/* Desktop segmented stepper */}
            <div className="flex items-center gap-0 pt-1 shrink-0">
              {steps.map((step, index) => {
                const isActive = currentStep === step.id;
                const isCompleted = currentStep > step.id;
                return (
                  <div key={step.id} className="flex items-center">
                    <div className="flex items-center gap-2.5">
                      <div
                        className={cn(
                          'w-7 h-7 rounded-full flex items-center justify-center text-[12px] font-bold tabular-nums transition-all shrink-0',
                          isActive && 'bg-[#F2A123] text-[lab(34.0831_-9.57756_-27.7093)] shadow-[0_0_0_3px_rgba(242,161,35,0.18)]',
                          isCompleted && 'bg-[lab(34.0831_-9.57756_-27.7093)] text-white',
                          !isActive && !isCompleted && 'bg-[#F3F4F6] text-muted-foreground border border-[#E2E8F0]'
                        )}
                      >
                        {isCompleted ? <Check className="w-3.5 h-3.5" strokeWidth={2.5} /> : step.id}
                      </div>
                      <span
                        className={cn(
                          'text-[13px] font-medium whitespace-nowrap transition-colors',
                          isActive ? 'text-[lab(34.0831_-9.57756_-27.7093)] font-semibold' : isCompleted ? 'text-[lab(34.0831_-9.57756_-27.7093)]/70' : 'text-muted-foreground'
                        )}
                      >
                        {step.title}
                      </span>
                    </div>
                    {index < steps.length - 1 && (
                      <div
                        className={cn(
                          'h-px w-10 mx-3 transition-colors',
                          isCompleted ? 'bg-[lab(34.0831_-9.57756_-27.7093)]/40' : 'bg-[#E2E8F0]'
                        )}
                        aria-hidden
                      />
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      <div className="px-4 py-3 bg-white border-b border-[#E2E8F0] md:hidden">
        <div className="flex items-center w-full max-w-6xl mx-auto">
          {steps.map((step, index) => {
            const Icon = step.icon;
            const isActive = currentStep === step.id;
            const isCompleted = currentStep > step.id;

            return (
              <div key={step.id} className="flex items-center flex-1 last:flex-none">
                <div className="flex flex-col items-center">
                  <div
                    className={cn(
                      'w-10 h-10 rounded-xl flex items-center justify-center transition-all',
                      isActive && 'bg-[#F2A123] text-[lab(34.0831_-9.57756_-27.7093)]',
                      isCompleted && 'bg-green-500 text-white',
                      !isActive && !isCompleted && 'bg-muted text-muted-foreground'
                    )}
                  >
                    {isCompleted ? <Check className="w-4 h-4" /> : <Icon className="w-4 h-4" />}
                  </div>
                  <span className={cn(
                    'text-[10px] mt-1 whitespace-nowrap',
                    isActive ? 'text-[lab(34.0831_-9.57756_-27.7093)] font-semibold' : 'text-muted-foreground'
                  )}>
                    {step.title}
                  </span>
                </div>
                {index < steps.length - 1 && (
                  <div className={cn(
                    'flex-1 h-0.5 mx-2',
                    currentStep > step.id ? 'bg-green-500' : 'bg-[#E2E8F0]'
                  )} />
                )}
              </div>
            );
          })}
        </div>
      </div>

      <main className="max-w-6xl mx-auto w-full px-4 md:px-6 py-4 md:py-6 lg:grid lg:grid-cols-12 lg:gap-8 lg:items-start">
        <div className="lg:col-span-7 min-w-0">
        {currentStep === 1 && (
          <div className="space-y-4 animate-fade-in">
            <CorridorRouteInfo originOnly />
            <AddressPicker
              type="sender"
              isLoggedIn={isLoggedIn}
              onSelect={(address: SavedAddress) => {
                setSenderName(address.full_name);
                setSenderCompany(address.company ?? '');
                setSenderPhone(address.phone.replace(/\D/g, '').slice(0, 10));
                setSenderAddress(address.address_line_1);
                setSenderCity(address.city);
                setSenderState(address.state ?? '');
                setSenderZip(address.pincode ?? '');
                setFieldErrors({});
              }}
            />

            <div className="bg-white rounded-xl border border-[#E2E8F0] p-4 space-y-3 shadow-[0_2px_12px_oklch(17%_0.048_248_/_0.06),_0_1px_3px_oklch(17%_0.048_248_/_0.04)]">
              <div>
                <Label className="text-xs text-muted-foreground">Full Name <span className="text-red-400">*</span></Label>
                <Input
                  value={senderName}
                  onChange={(e) => {
                    setSenderName(e.target.value);
                    clearFieldError('senderName');
                  }}
                  placeholder="John Doe"
                  className={fieldBorderClass('senderName')}
                  data-testid="input-sender-name"
                />
                {fieldErrors.senderName && (
                  <p className="text-xs text-red-600 mt-1">This field is required</p>
                )}
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Company Name <span className="text-muted-foreground/60">(optional)</span></Label>
                <Input
                  value={senderCompany}
                  onChange={(e) => setSenderCompany(e.target.value)}
                  placeholder="Company name"
                  className="h-11 mt-1 text-sm bg-muted/30 border-border rounded-xl"
                  data-testid="input-sender-company"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs text-muted-foreground">Email</Label>
                  <Input
                    type="email"
                    value={senderEmail}
                    onChange={(e) => setSenderEmail(e.target.value)}
                    className="h-11 mt-1 text-sm bg-muted/30 border-border rounded-xl"
                    data-testid="input-sender-email"
                  />
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">
                    Phone
                    <span className="text-red-400">*</span>
                  </Label>
                  <Input
                    value={senderPhone}
                    onChange={(e) => {
                      const digits = e.target.value.replace(/\D/g, '').slice(0, 10);
                      setSenderPhone(digits);
                      clearFieldError('senderPhone');
                    }}
                    placeholder="+91"
                    className={fieldBorderClass('senderPhone')}
                    data-testid="input-sender-phone"
                  />
                  {fieldErrors.senderPhone && (
                    <p className="text-xs text-red-600 mt-1">Must be exactly 10 digits</p>
                  )}
                </div>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Address</Label>
                <Input
                  value={senderAddress}
                  onChange={(e) => {
                    setSenderAddress(e.target.value);
                    clearFieldError('senderAddress');
                  }}
                  placeholder="Street address"
                  className={fieldBorderClass('senderAddress')}
                  data-testid="input-sender-address"
                />
                {fieldErrors.senderAddress && (
                  <p className="text-xs text-red-600 mt-1">This field is required</p>
                )}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-xs text-muted-foreground">Pincode</Label>
                  <Input
                    value={senderZip}
                    onChange={(e) => {
                      setSenderZip(e.target.value);
                      clearFieldError('senderZip');
                    }}
                    onBlur={() => {
                      void lookupSenderPincode(senderZip, 'IN', ({ city, state }) => {
                        setSenderCity(city);
                        setSenderState(state);
                        clearFieldError('senderCity');
                        clearFieldError('senderState');
                      });
                    }}
                    maxLength={6}
                    className={fieldBorderClass('senderZip')}
                    data-testid="input-sender-zip"
                  />
                  {senderPincodeHint && (
                    <p className="text-[0.65rem] leading-tight whitespace-nowrap mt-0.5 text-muted-foreground">
                      {senderPincodeHint}
                    </p>
                  )}
                  {fieldErrors.senderZip && (
                    <p className="text-xs text-red-600 mt-1">This field is required</p>
                  )}
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">City</Label>
                  <Input
                    value={senderCity}
                    onChange={(e) => {
                      setSenderCity(e.target.value);
                      clearFieldError('senderCity');
                    }}
                    className={fieldBorderClass('senderCity')}
                    data-testid="input-sender-city"
                  />
                  {fieldErrors.senderCity && (
                    <p className="text-xs text-red-600 mt-1">This field is required</p>
                  )}
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">State</Label>
                  <Input
                    value={senderState}
                    onChange={(e) => {
                      setSenderState(e.target.value);
                      clearFieldError('senderState');
                    }}
                    className={fieldBorderClass('senderState')}
                    data-testid="input-sender-state"
                  />
                  {fieldErrors.senderState && (
                    <p className="text-xs text-red-600 mt-1">This field is required</p>
                  )}
                </div>
              </div>
            </div>

            <div className="bg-white rounded-xl border border-[#E2E8F0] p-4 shadow-[0_2px_12px_oklch(17%_0.048_248_/_0.06),_0_1px_3px_oklch(17%_0.048_248_/_0.04)]">
              <Label className="text-sm font-semibold mb-3 block">Pickup or Drop-off?</Label>

              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">How should we get your parcel?</span>
                <div className="flex gap-3">
                  {(
                    [
                      { val: '1', label: 'Pickup' },
                      { val: '2', label: 'Drop-off' },
                    ] as const
                  ).map(({ val, label }) => (
                    <button
                      key={val}
                      type="button"
                      onClick={() => {
                        setPickupRequest(val);
                        if (val === '2') setPickupDate('');
                        clearFieldError('pickupDate');
                      }}
                      className={cn(
                        'px-3 py-1 text-xs',
                        'rounded-full border',
                        'transition-colors',
                        pickupRequest === val
                          ? 'bg-primary text-white border-primary'
                          : 'border-border text-muted-foreground'
                      )}
                      data-testid={`button-pickup-request-${val}`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {pickupRequest === '1' && (
                <div className="mt-3 space-y-3 pt-3 border-t border-border">
                  <div>
                    <Label className="text-xs text-muted-foreground">
                      Pickup date
                      <span className="text-red-400">*</span>
                    </Label>
                    <button
                      type="button"
                      onClick={() => setPickupDatePickerOpen(true)}
                      className={cn(
                        fieldBorderClass('pickupDate'),
                        'w-full flex items-center justify-between px-3 text-left'
                      )}
                      data-testid="input-pickup-date"
                    >
                      <span className={cn(!pickupDate && 'text-muted-foreground')}>
                        {pickupDate
                          ? format(new Date(`${pickupDate}T00:00:00`), 'EEE, MMM d, yyyy')
                          : 'Select a date'}
                      </span>
                      <CalendarIcon className="w-4 h-4 shrink-0 text-muted-foreground" aria-hidden />
                    </button>
                    {fieldErrors.pickupDate && (
                      <p className="text-xs text-red-600 mt-1">This field is required</p>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Company accounts: nothing here. Identity was settled by GST at
                signup — see A2. Personal accounts still need a document on
                file, but are only asked once. */}
            {kycRequired && (
              kycOnFile ? (
                <div className="space-y-2">
                  <KycOnFileCard kyc={kycOnFile} />
                  <button
                    type="button"
                    onClick={() => {
                      setShowKycUpdate((v) => {
                        // Discard a half-finished replacement when collapsing,
                        // so a stale kycResult cannot ride along on submit.
                        if (v) setKycResult(null);
                        return !v;
                      });
                    }}
                    className="text-[11px] font-semibold text-primary"
                    aria-expanded={showKycUpdate}
                    data-testid="button-kyc-update-toggle"
                  >
                    {showKycUpdate ? 'Cancel update' : 'Update KYC'}
                  </button>
                  {showKycUpdate && <KycUpload onValidChange={setKycResult} />}
                </div>
              ) : (
                <KycUpload
                  onValidChange={setKycResult}
                  fieldErrors={{
                    document_no: !!fieldErrors.kycMissing,
                    file: !!fieldErrors.kycMissing,
                  }}
                />
              )
            )}

            {stepError && (
              <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-xl p-3">
                <AlertTriangle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
                <p className="text-xs text-red-600">{stepError}</p>
              </div>
            )}

            <Button
              onClick={handleNext}
              className="w-full h-12 bg-[#F2A123] hover:bg-[#F2A123]/90 text-[lab(34.0831_-9.57756_-27.7093)] text-sm font-semibold rounded-xl shadow-[0_4px_20px_oklch(17%_0.048_248_/_0.10)]"
              data-testid="button-next-step"
            >
              Continue
              <ArrowRight className="w-4 h-4 ml-1" />
            </Button>
          </div>
        )}

        {currentStep === 2 && (
          <div className="space-y-4 animate-fade-in">
            <CorridorRouteInfo
              destinationCode={destinationCountry}
              destinationName={formatCountryDisplay(
                ITD_COUNTRY_MAP[destinationCountry]?.name ?? destinationCountry
              )}
            />
            <div className="bg-white rounded-xl border border-[#E2E8F0] p-4 shadow-[0_2px_12px_oklch(17%_0.048_248_/_0.06),_0_1px_3px_oklch(17%_0.048_248_/_0.04)] space-y-2">
              <Label className="text-xs text-muted-foreground">Destination Country</Label>
              <CountryCombobox
                value={destinationCountry}
                onValueChange={(code) => {
                  setDestinationCountry(code);
                  clearFieldError('destinationCountry');
                }}
              />
            </div>
            <AddressPicker
              type="recipient"
              isLoggedIn={isLoggedIn}
              onSelect={(address: SavedAddress) => {
                setReceiverName(address.full_name);
                setReceiverCompany(address.company ?? '');
                setReceiverAddress(address.address_line_1);
                setReceiverCity(address.city);
                setReceiverState(address.state ?? '');
                setReceiverZip(address.pincode ?? '');
                setFieldErrors({});

                // Update destination country from saved address if available
                if (address.country_code && address.country_code !== 'IN') {
                  setDestinationCountry(address.country_code);
                }

                // Strip dial code from stored phone since consignee_contact_no is stored with prefix
                const rawPhone = address.phone.replace(/\D/g, '');
                const dialCode = address.country_code
                  ? (ITD_COUNTRY_MAP[address.country_code]?.dialCode ?? '').replace(/\D/g, '')
                  : '';
                const phoneDigits =
                  dialCode && rawPhone.startsWith(dialCode) ? rawPhone.slice(dialCode.length) : rawPhone;
                setReceiverPhone(phoneDigits);
              }}
            />

            <div className="bg-white rounded-xl border border-[#E2E8F0] p-4 space-y-3 shadow-[0_2px_12px_oklch(17%_0.048_248_/_0.06),_0_1px_3px_oklch(17%_0.048_248_/_0.04)]">
              <div>
                <Label className="text-xs text-muted-foreground">Receiver Name</Label>
                <Input
                  value={receiverName}
                  onChange={(e) => {
                    setReceiverName(e.target.value);
                    clearFieldError('receiverName');
                  }}
                  className={fieldBorderClass('receiverName')}
                  data-testid="input-receiver-name"
                />
                {fieldErrors.receiverName && (
                  <p className="text-xs text-red-600 mt-1">This field is required</p>
                )}
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Company Name <span className="text-muted-foreground/60">(optional)</span></Label>
                <Input
                  value={receiverCompany}
                  onChange={(e) => setReceiverCompany(e.target.value)}
                  placeholder="Company name"
                  className="h-11 mt-1 text-sm bg-muted/30 border-border rounded-xl"
                  data-testid="input-receiver-company"
                />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">
                  Phone
                  <span className="text-red-400">*</span>
                </Label>
                <div className="flex gap-2 mt-1">
                  {ITD_COUNTRY_MAP[destinationCountry]?.dialCode ? (
                    <div className="h-11 px-3 flex items-center bg-muted/50 border border-border rounded-xl text-sm text-muted-foreground shrink-0 font-medium">
                      {ITD_COUNTRY_MAP[destinationCountry].dialCode}
                    </div>
                  ) : null}
                  <Input
                    value={receiverPhone}
                    onChange={(e) => {
                      const digits = e.target.value.replace(/\D/g, '');
                      setReceiverPhone(digits);
                      clearFieldError('receiverPhone');
                    }}
                    placeholder="Phone number"
                    className={cn(
                      'flex-1 min-w-0',
                      fieldBorderClass('receiverPhone')
                    )}
                    data-testid="input-receiver-phone"
                  />
                </div>
                {fieldErrors.receiverPhone && (
                  <p className="text-xs text-red-600 mt-1">Must be 6–15 digits</p>
                )}
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">
                  Email <span className="text-muted-foreground/60 ml-1">(optional)</span>
                </Label>
                <Input
                  type="email"
                  value={receiverEmail}
                  onChange={(e) => setReceiverEmail(e.target.value)}
                  className="h-11 mt-1 text-sm bg-muted/30 border-border rounded-xl"
                  data-testid="input-receiver-email"
                />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Address</Label>
                <Input
                  value={receiverAddress}
                  onChange={(e) => {
                    setReceiverAddress(e.target.value);
                    clearFieldError('receiverAddress');
                  }}
                  className={fieldBorderClass('receiverAddress')}
                  data-testid="input-receiver-address"
                />
                {fieldErrors.receiverAddress && (
                  <p className="text-xs text-red-600 mt-1">This field is required</p>
                )}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-xs text-muted-foreground">Postal Code</Label>
                  <Input
                    value={receiverZip}
                    onChange={(e) => {
                      setReceiverZip(e.target.value);
                      clearFieldError('receiverZip');
                    }}
                    onBlur={() => {
                      void lookupReceiverPincode(receiverZip, destinationCountry, ({ city, state }) => {
                        setReceiverCity(city);
                        setReceiverState(state);
                        clearFieldError('receiverCity');
                        clearFieldError('receiverState');
                      });
                    }}
                    className={fieldBorderClass('receiverZip')}
                    data-testid="input-receiver-pincode"
                  />
                  {receiverPincodeHint && (
                    <p className="text-[0.65rem] leading-tight whitespace-nowrap mt-0.5 text-muted-foreground">
                      {receiverPincodeHint}
                    </p>
                  )}
                  {fieldErrors.receiverZip && (
                    <p className="text-xs text-red-600 mt-1">This field is required</p>
                  )}
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">City</Label>
                  <Input
                    value={receiverCity}
                    onChange={(e) => {
                      setReceiverCity(e.target.value);
                      clearFieldError('receiverCity');
                    }}
                    className={fieldBorderClass('receiverCity')}
                    data-testid="input-receiver-city"
                  />
                  {fieldErrors.receiverCity && (
                    <p className="text-xs text-red-600 mt-1">This field is required</p>
                  )}
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">State</Label>
                  <Input
                    value={receiverState}
                    onChange={(e) => {
                      setReceiverState(e.target.value);
                      clearFieldError('receiverState');
                    }}
                    className={fieldBorderClass('receiverState')}
                    data-testid="input-receiver-state"
                  />
                  {fieldErrors.receiverState && (
                    <p className="text-xs text-red-600 mt-1">This field is required</p>
                  )}
                </div>
              </div>
            </div>

            {stepError && (
              <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-xl p-3">
                <AlertTriangle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
                <p className="text-xs text-red-600">{stepError}</p>
              </div>
            )}

            <Button
              onClick={handleNext}
              className="w-full h-12 bg-[#F2A123] hover:bg-[#F2A123]/90 text-[lab(34.0831_-9.57756_-27.7093)] text-sm font-semibold rounded-xl shadow-[0_4px_20px_oklch(17%_0.048_248_/_0.10)]"
              data-testid="button-next-step"
            >
              Continue
              <ArrowRight className="w-4 h-4 ml-1" />
            </Button>
          </div>
        )}

        {currentStep === 3 && (
          <div className="space-y-4 animate-fade-in">
            <div className="bg-white rounded-xl border border-[#E2E8F0] p-4 shadow-[0_2px_12px_oklch(17%_0.048_248_/_0.06),_0_1px_3px_oklch(17%_0.048_248_/_0.04)]">
              <ShipmentContentSearch
                value={shipmentContent}
                onChange={(v) => {
                  setShipmentContent(v);
                  setHsCode('');
                  clearFieldError('shipmentContent');
                }}
                onSelect={(desc, code) => {
                  setShipmentContent(desc);
                  setHsCode(code);
                  clearFieldError('shipmentContent');
                }}
                error={!!fieldErrors.shipmentContent}
              />
              {fieldErrors.shipmentContent && (
                <p className="text-xs text-red-600 mt-1">This field is required</p>
              )}
            </div>

            <div className="bg-white rounded-xl border border-[#E2E8F0] p-4 shadow-[0_2px_12px_oklch(17%_0.048_248_/_0.06),_0_1px_3px_oklch(17%_0.048_248_/_0.04)]">
              <div className="flex items-center justify-between mb-3">
                <Label className="text-sm font-semibold">Weight</Label>
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
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs text-muted-foreground">
                    Weight ({weightUnit})
                    <span className="text-red-400">*</span>
                  </Label>
                  <Input
                    type="number"
                    value={weight}
                    onChange={(e) => {
                      setWeight(e.target.value);
                      clearFieldError('weight');
                    }}
                    className={fieldBorderClass('weight')}
                    step="0.1"
                    min="0.1"
                    data-testid="input-package-weight"
                  />
                  {fieldErrors.weight && (
                    <p className="text-xs text-red-600 mt-1">This field is required</p>
                  )}
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Pieces</Label>
                  <Input
                    type="number"
                    value={pieces}
                    onChange={(e) => setPieces(e.target.value)}
                    className="h-11 mt-1 text-sm bg-muted/30 border-border rounded-xl"
                    min="1"
                    data-testid="input-package-pieces"
                  />
                </div>
              </div>
              <p className="text-[10px] text-muted-foreground mt-2">
                ≈ {weightUnit === 'lb' ? `${(parseFloat(weight) * 0.453592).toFixed(2)} kg` : `${(parseFloat(weight) / 0.453592).toFixed(1)} lb`}
              </p>
            </div>

            {/* Packaging — asked here, on the Package step, because it is a
                fact about the parcel and not about how it travels. Sits between
                weight and dimensions on purpose: the answer changes what the
                customer should measure, since a parcel we pack ends up in our
                box and not theirs. Carries no price: any packaging cost is
                settled at the hub with the rest of the reprice, so nothing on
                this card moves the quote. */}
            <div className="bg-white rounded-xl border border-[#E2E8F0] p-4 shadow-[0_2px_12px_oklch(17%_0.048_248_/_0.06),_0_1px_3px_oklch(17%_0.048_248_/_0.04)]">
              <Label className="text-sm font-semibold mb-3 block">Packaging</Label>

              <div className="flex items-center justify-between gap-3">
                <span className="text-xs text-muted-foreground">Do you need us to pack it?</span>
                <div className="flex gap-3">
                  {(
                    [
                      { val: false, label: 'Already packed' },
                      { val: true, label: 'Pack it for me' },
                    ] as const
                  ).map(({ val, label }) => (
                    <button
                      key={String(val)}
                      type="button"
                      onClick={() => {
                        setPackagingRequired(val);
                        // The preset block is about to disappear. Clear what it
                        // put in the dimension fields with it — leaving numbers
                        // the customer never typed, under a hint telling them to
                        // measure their own box, is the wrong kind of quiet.
                        if (!val && selectedPreset) {
                          setSelectedPreset(null);
                          setDimL('');
                          setDimW('');
                          setDimH('');
                        }
                      }}
                      className={cn(
                        'px-3 py-1 text-xs',
                        'rounded-full border',
                        'transition-colors',
                        packagingRequired === val
                          ? 'bg-primary text-white border-primary'
                          : 'border-border text-muted-foreground'
                      )}
                      data-testid={`button-packaging-${val ? 'yes' : 'no'}`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              <p className="text-[10px] text-muted-foreground mt-3 pt-3 border-t border-border">
                {packagingRequired
                  ? pickupRequest === '1'
                    ? 'The agent brings packaging material to your door. Any packaging charge is added when we weigh the parcel — not to the quote below.'
                    : 'We pack your parcel at the hub counter. Any packaging charge is added when we weigh it — not to the quote below.'
                  : 'Hand us a sealed parcel. Fragile items travel better packed by us.'}
              </p>
            </div>

            <div className="bg-white rounded-xl border border-[#E2E8F0] p-4 shadow-[0_2px_12px_oklch(17%_0.048_248_/_0.06),_0_1px_3px_oklch(17%_0.048_248_/_0.04)]">
              <div className="flex items-center justify-between mb-3">
                <Label className="text-sm font-semibold">
                  Dimensions <span className="text-red-400">*</span>
                </Label>
                <div className="flex bg-muted rounded-lg p-0.5">
                  <button
                    onClick={() => setDimUnit('in')}
                    className={cn(
                      'px-3 py-1 text-xs font-medium rounded-md transition-colors',
                      dimUnit === 'in' ? 'bg-white text-primary shadow-sm' : 'text-muted-foreground'
                    )}
                  >
                    in
                  </button>
                  <button
                    onClick={() => setDimUnit('cm')}
                    className={cn(
                      'px-3 py-1 text-xs font-medium rounded-md transition-colors',
                      dimUnit === 'cm' ? 'bg-white text-primary shadow-sm' : 'text-muted-foreground'
                    )}
                  >
                    cm
                  </button>
                </div>
              </div>
              {/* Which object to measure depends on the answer given one card
                  up. A customer packing their own parcel measures the box they
                  will hand over; one asking us to pack measures the contents,
                  because the box does not exist yet. Same fields, different
                  question — so the question is stated rather than assumed. */}
              <p
                className="text-[10px] text-muted-foreground mt-2"
                data-testid="text-dimensions-hint"
              >
                {packagingRequired
                  ? 'Measure the items you are sending, not a box. We pick packaging to fit and re-measure at the hub.'
                  : 'Measure the packed parcel at its widest points, including the box.'}
              </p>
              {/* Presets are our standard box sizes, so they only mean
                  anything when we are the ones packing. A customer measuring a
                  box they already sealed has nothing to pick from a list. */}
              {packagingRequired && (
                <div className="mt-3 mb-3">
                  <button
                    type="button"
                    onClick={() => setShowPresetSheet(true)}
                    className="w-full py-2 px-3 border border-dashed border-[#14567C] rounded-xl bg-blue-50/40 text-[#14567C] text-xs font-medium flex items-center justify-center gap-2 hover:bg-blue-50 transition-colors"
                  >
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      aria-hidden
                    >
                      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
                    </svg>
                    Choose preset size
                  </button>
                  {selectedPreset && (
                    <div className="flex items-center gap-1.5 mt-2">
                      <span className="flex items-center gap-1 bg-blue-50 border border-[#14567C]/20 rounded-full px-3 py-1 text-xs text-[#14567C] font-medium">
                        {DIMENSION_PRESETS.find((p) => p.id === selectedPreset)?.label}
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedPreset(null);
                            setDimL('');
                            setDimW('');
                            setDimH('');
                          }}
                          className="ml-1 text-[#14567C]/60 hover:text-[#14567C]"
                          aria-label="Clear preset"
                        >
                          ✕
                        </button>
                      </span>
                    </div>
                  )}
                </div>
              )}
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <Label className="text-xs text-muted-foreground">
                    L<span className="text-red-400">*</span>
                  </Label>
                  <Input
                    type="number"
                    value={dimL}
                    onChange={(e) => {
                      setDimL(e.target.value);
                      clearFieldError('dimL');
                    }}
                    placeholder="12"
                    className={fieldBorderClass('dimL')}
                  />
                  {fieldErrors.dimL && (
                    <p className="text-xs text-red-600 mt-1">This field is required</p>
                  )}
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">
                    W<span className="text-red-400">*</span>
                  </Label>
                  <Input
                    type="number"
                    value={dimW}
                    onChange={(e) => {
                      setDimW(e.target.value);
                      clearFieldError('dimW');
                    }}
                    placeholder="10"
                    className={fieldBorderClass('dimW')}
                  />
                  {fieldErrors.dimW && (
                    <p className="text-xs text-red-600 mt-1">This field is required</p>
                  )}
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">
                    H<span className="text-red-400">*</span>
                  </Label>
                  <Input
                    type="number"
                    value={dimH}
                    onChange={(e) => {
                      setDimH(e.target.value);
                      clearFieldError('dimH');
                    }}
                    placeholder="8"
                    className={fieldBorderClass('dimH')}
                  />
                  {fieldErrors.dimH && (
                    <p className="text-xs text-red-600 mt-1">This field is required</p>
                  )}
                </div>
              </div>
            </div>

            <div className="bg-white rounded-xl border border-[#E2E8F0] p-4 shadow-[0_2px_12px_oklch(17%_0.048_248_/_0.06),_0_1px_3px_oklch(17%_0.048_248_/_0.04)]">
              <Label className="text-sm font-semibold mb-3 block">Shipment Value</Label>
              <div className="grid grid-cols-3 gap-2">
                <div className="col-span-2">
                  <Label className="text-xs text-muted-foreground">
                    Declared Value
                    <span className="text-red-400">*</span>
                  </Label>
                  <Input
                    type="number"
                    value={shipmentValue}
                    onChange={(e) => {
                      setShipmentValue(e.target.value);
                      clearFieldError('shipmentValue');
                    }}
                    placeholder="100"
                    className={fieldBorderClass('shipmentValue')}
                    min="0"
                    step="0.01"
                    data-testid="input-shipment-value"
                  />
                  {fieldErrors.shipmentValue && (
                    <p className="text-xs text-red-600 mt-1">This field is required</p>
                  )}
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Currency</Label>
                  {(() => {
                    const destCurrency = getDestinationCurrency(destinationCountry);
                    const showToggle = destCurrency !== null && destCurrency !== 'INR';
                    if (!showToggle) {
                      return (
                        <div className="h-11 mt-1 flex items-center justify-center bg-muted/50 border border-border rounded-xl text-sm font-medium text-muted-foreground">
                          INR
                        </div>
                      );
                    }
                    return (
                      <div className="flex bg-muted rounded-lg p-0.5 mt-1">
                        {(['INR', destCurrency] as string[]).map((cur) => (
                          <button
                            key={cur}
                            type="button"
                            onClick={() => setSelectedCurrency(cur)}
                            className={cn(
                              'flex-1 py-2 text-xs font-medium rounded-md transition-colors',
                              selectedCurrency === cur ? 'bg-white text-primary shadow-sm' : 'text-muted-foreground'
                            )}
                          >
                            {cur}
                          </button>
                        ))}
                      </div>
                    );
                  })()}
                </div>
              </div>
              <p className="text-[10px] text-muted-foreground mt-1.5">Customs declared value for international shipping</p>
            </div>

            {stepError && (
              <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-xl p-3">
                <AlertTriangle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
                <p className="text-xs text-red-600">{stepError}</p>
              </div>
            )}

            <Button
              onClick={handleNext}
              className="w-full h-12 bg-[#F2A123] hover:bg-[#F2A123]/90 text-[lab(34.0831_-9.57756_-27.7093)] text-sm font-semibold rounded-xl shadow-[0_4px_20px_oklch(17%_0.048_248_/_0.10)]"
              data-testid="button-next-step"
            >
              Continue
              <ArrowRight className="w-4 h-4 ml-1" />
            </Button>
          </div>
        )}

        {currentStep === 4 && (
          <div className="space-y-4 animate-fade-in">
            <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 text-xs text-blue-700">
              Required for Indian customs clearance. These details appear on the commercial invoice.
            </div>

            <div className="bg-white rounded-xl border border-[#E2E8F0] p-4 shadow-[0_2px_12px_oklch(17%_0.048_248_/_0.06),_0_1px_3px_oklch(17%_0.048_248_/_0.04)]">
              <Label className="text-sm font-semibold mb-3 block">Service Details</Label>
              <div className="space-y-2">
                <div className="space-y-1">
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm text-muted-foreground">Product Type</span>
                    <button
                      type="button"
                      onClick={() => setShowProductTypeInfo(true)}
                      className="text-muted-foreground hover:text-primary transition-colors"
                      aria-label="Product type information"
                    >
                      <Info className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <Select
                    value={productType || undefined}
                    onValueChange={applyProductType}
                    disabled={productTypeLocked}
                  >
                    <SelectTrigger
                      className={cn(
                        'mt-1',
                        fieldErrors.productType && 'border-2 border-primary field-shake'
                      )}
                      data-testid="select-product-type"
                    >
                      <SelectValue placeholder="Select product type" />
                    </SelectTrigger>
                    <SelectContent>
                      {productTypeOptions.map(({ value, label }) => (
                        <SelectItem key={value} value={value}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {productTypeLocked && (
                    <p
                      className="text-[10px] text-muted-foreground mt-1"
                      data-testid="text-product-type-locked"
                    >
                      Set by the {DIMENSION_PRESETS.find((p) => p.id === selectedPreset)?.label}{' '}
                      size you chose. Clear it on the Package step to change this.
                    </p>
                  )}
                </div>
                {productType === 'CSB V' && (
                  <div className="mt-3 space-y-3 pt-3 border-t border-border">
                    <p className="text-xs font-semibold text-foreground">
                      CSB V Details
                    </p>

                    <div>
                      <Label className="text-xs text-muted-foreground">
                        HS Code (10 digits)
                        <span className="text-red-400">
                          *
                        </span>
                      </Label>
                      <Input
                        type="text"
                        value={csbvHsCode}
                        onChange={(e) => {
                          const val = e.target.value
                            .replace(/\D/g, '')
                            .slice(0, 10);
                          setCsbvHsCode(val);
                          clearFieldError('csbvHsCode');
                        }}
                        placeholder="Enter 10-digit HS code"
                        maxLength={10}
                        className={cn(
                          'mt-1',
                          fieldBorderClass('csbvHsCode')
                        )}
                      />
                      {fieldErrors.csbvHsCode && (
                        <p className="text-xs text-red-600 mt-1">
                          HS code must be exactly
                          10 digits
                        </p>
                      )}
                    </div>

                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">
                        E-commerce Shipment?
                      </span>
                      <div className="flex gap-3">
                        {(['yes', 'no'] as const).map(
                          (opt) => (
                            <button
                              key={opt}
                              type="button"
                              onClick={() =>
                                setCsbvEcommerce(opt)}
                              className={cn(
                                'px-3 py-1 text-xs',
                                'rounded-full border',
                                'transition-colors',
                                csbvEcommerce === opt
                                  ? 'bg-primary text-white border-primary'
                                  : 'border-border text-muted-foreground'
                              )}
                            >
                              {opt.toUpperCase()}
                            </button>
                          )
                        )}
                      </div>
                    </div>

                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">
                        Under a Scheme?
                      </span>
                      <div className="flex gap-3">
                        {(['yes', 'no'] as const).map(
                          (opt) => (
                            <button
                              key={opt}
                              type="button"
                              onClick={() =>
                                setCsbvScheme(opt)}
                              className={cn(
                                'px-3 py-1 text-xs',
                                'rounded-full border',
                                'transition-colors',
                                csbvScheme === opt
                                  ? 'bg-primary text-white border-primary'
                                  : 'border-border text-muted-foreground'
                              )}
                            >
                              {opt.toUpperCase()}
                            </button>
                          )
                        )}
                      </div>
                    </div>

                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">
                        Postal Product Type
                        <span className="text-red-400 ml-0.5">*</span>
                      </span>
                      <div className="flex gap-2 flex-wrap justify-end max-w-[200px]">
                        {(
                          [
                            'Fine Jewellery',
                            'Stones',
                            'BPN Service',
                            'Postal',
                          ] as const
                        ).map((opt) => (
                          <button
                            key={opt}
                            type="button"
                            onClick={() => setCsbvDispatchType(opt)}
                            className={cn(
                              'px-3 py-1 text-xs',
                              'rounded-full border',
                              'transition-colors',
                              csbvDispatchType === opt
                                ? 'bg-primary text-white border-primary'
                                : 'border-border text-muted-foreground'
                            )}
                          >
                            {opt}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">
                        Bond UT / IGST
                      </span>
                      <div className="flex gap-3">
                        {([
                          { val: 'bond_ut', label: 'Bond UT' },
                          { val: 'igst', label: 'IGST' }
                        ] as const).map(({ val, label }) => (
                          <button
                            key={val}
                            type="button"
                            onClick={() => {
                              setCsbvBondType(val);
                              setCsbvIgstAmount('');
                              setCsbvLutNumber('');
                              setCsbvLutFrom('');
                              setCsbvLutTill('');
                            }}
                            className={cn(
                              'px-3 py-1 text-xs',
                              'rounded-full border',
                              'transition-colors',
                              csbvBondType === val
                                ? 'bg-primary text-white border-primary'
                                : 'border-border text-muted-foreground'
                            )}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    </div>

                    {csbvBondType === 'igst' ? (
                      <div>
                        <Label className="text-xs text-muted-foreground">
                          IGST Amount ({selectedCurrency})
                          <span className="text-red-400">
                            *
                          </span>
                        </Label>
                        <Input
                          type="number"
                          value={csbvIgstAmount}
                          onChange={(e) => {
                            setCsbvIgstAmount(e.target.value);
                            clearFieldError('csbvIgstAmount');
                          }}
                          placeholder="0.00"
                          className={cn(
                            'mt-1',
                            fieldBorderClass('csbvIgstAmount')
                          )}
                        />
                        {fieldErrors.csbvIgstAmount && (
                          <p className="text-xs text-red-600 mt-1">
                            IGST amount is required
                          </p>
                        )}
                      </div>
                    ) : (
                      <div className="space-y-3">
                        <div>
                          <Label className="text-xs text-muted-foreground">
                            LUT Number
                            <span className="text-red-400">
                              *
                            </span>
                          </Label>
                          <Input
                            type="text"
                            value={csbvLutNumber}
                            onChange={(e) => {
                              setCsbvLutNumber(
                                e.target.value);
                              clearFieldError(
                                'csbvLutNumber');
                            }}
                            placeholder="Enter LUT number"
                            className={cn(
                              'mt-1',
                              fieldBorderClass('csbvLutNumber')
                            )}
                          />
                          {fieldErrors.csbvLutNumber && (
                            <p className="text-xs text-red-600 mt-1">
                              LUT number is required
                            </p>
                          )}
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <Label className="text-xs text-muted-foreground">
                              LUT Issue From
                              <span className="text-red-400">
                                *
                              </span>
                            </Label>
                            <Input
                              type="date"
                              value={csbvLutFrom}
                              onChange={(e) => {
                                setCsbvLutFrom(
                                  e.target.value);
                                clearFieldError(
                                  'csbvLutFrom');
                              }}
                              className={cn(
                                'mt-1',
                                fieldBorderClass('csbvLutFrom')
                              )}
                            />
                            {fieldErrors.csbvLutFrom && (
                              <p className="text-xs text-red-600 mt-1">
                                Required
                              </p>
                            )}
                          </div>
                          <div>
                            <Label className="text-xs text-muted-foreground">
                              LUT Issue Till
                              <span className="text-red-400">
                                *
                              </span>
                            </Label>
                            <Input
                              type="date"
                              value={csbvLutTill}
                              onChange={(e) => {
                                setCsbvLutTill(
                                  e.target.value);
                                clearFieldError(
                                  'csbvLutTill');
                              }}
                              className={cn(
                                'mt-1',
                                fieldBorderClass('csbvLutTill')
                              )}
                            />
                            {fieldErrors.csbvLutTill && (
                              <p className="text-xs text-red-600 mt-1">
                                Required
                              </p>
                            )}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )}
                {productType !== 'CSB V' && (
                  <div className="flex justify-between text-sm gap-2">
                    <span className="text-muted-foreground shrink-0">HS Code</span>
                    <span className="font-medium text-foreground text-right text-xs break-all">
                      {hsCode || '—'}
                    </span>
                  </div>
                )}

                <div className="pt-2 lg:hidden">
                  <Label className="text-xs text-muted-foreground mb-1.5 block">
                    Shipping Service
                    <span className="text-red-400">*</span>
                  </Label>

                  {selectedService ? (
                    <button
                      type="button"
                      onClick={handleOpenServiceModal}
                      className="w-full flex items-center justify-between gap-3 rounded-xl border border-[#E2E8F0] bg-white px-4 py-3 text-left hover:border-[#F2A123]/50 transition-colors"
                      data-testid="button-change-service"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-[lab(34.0831_-9.57756_-27.7093)] truncate">
                          {selectedService.internal_api_service_code || selectedService.code}
                        </p>
                        <p className="text-xs text-muted-foreground">{formatInr(selectedService.total)} · incl. GST</p>
                      </div>
                      <span className="text-xs font-medium text-[#F2A123] shrink-0">Change</span>
                    </button>
                  ) : (
                    <Button
                      type="button"
                      onClick={handleOpenServiceModal}
                      disabled={!productType.trim() || rateMutation.isPending}
                      className="w-full h-12 bg-[#F2A123] hover:bg-[#F2A123]/90 text-[lab(34.0831_-9.57756_-27.7093)] text-sm font-semibold rounded-xl shadow-[0_4px_20px_oklch(17%_0.048_248_/_0.10)] disabled:opacity-70 flex items-center justify-center gap-2"
                      data-testid="button-get-rates-invoice"
                    >
                      {rateMutation.isPending ? (
                        <Loader2 className="w-5 h-5 animate-spin" />
                      ) : (
                        <>
                          <Zap className="w-4 h-4 shrink-0" aria-hidden />
                          Get Rates
                        </>
                      )}
                    </Button>
                  )}

                  {ratesError ? (
                    <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-xl p-3 mt-3">
                      <AlertTriangle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
                      <p className="text-xs text-red-600">{ratesError}</p>
                    </div>
                  ) : null}

                  {serviceSelectionError ? (
                    <div className="field-shake flex items-start gap-2 bg-red-50 border border-red-200 rounded-xl p-3 mt-3">
                      <AlertTriangle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
                      <p className="text-xs text-red-600">{serviceSelectionError}</p>
                    </div>
                  ) : null}
                </div>
              </div>
            </div>

            <div className="bg-white rounded-xl border border-[#E2E8F0] p-4 space-y-3 shadow-[0_2px_12px_oklch(17%_0.048_248_/_0.06),_0_1px_3px_oklch(17%_0.048_248_/_0.04)]">
              <div>
                <Label className="text-sm font-semibold">Invoice Item</Label>
                <p className="text-xs text-muted-foreground mt-0.5">
                  For the customs invoice — how many units are in this shipment, what one unit weighs, and its declared value per unit.
                </p>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Description</Label>
                <div className="h-11 mt-1 px-3 flex items-center bg-muted/50 border border-border rounded-xl text-sm text-muted-foreground">
                  {shipmentContent.trim() || 'GIFTS'}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs text-muted-foreground">
                    Quantity
                    <span className="text-red-400">*</span>
                  </Label>
                  <Input
                    type="number"
                    value={invoiceQty}
                    onChange={(e) => {
                      setInvoiceQty(e.target.value);
                      clearFieldError('invoiceQty');
                    }}
                    min="1"
                    className={fieldBorderClass('invoiceQty')}
                    data-testid="input-invoice-qty"
                  />
                  <p className="text-[10px] text-muted-foreground mt-1">Number of units of this item</p>
                  {fieldErrors.invoiceQty && (
                    <p className="text-xs text-red-600 mt-1">This field is required</p>
                  )}
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">
                    Unit Weight (kg)
                    <span className="text-red-400">*</span>
                  </Label>
                  <Input
                    type="number"
                    value={invoiceUnitWeight}
                    onChange={(e) => {
                      setInvoiceUnitWeight(e.target.value);
                      clearFieldError('invoiceUnitWeight');
                    }}
                    placeholder="0.00"
                    step="0.01"
                    className={fieldBorderClass('invoiceUnitWeight')}
                    data-testid="input-invoice-unit-weight"
                  />
                  <p className="text-[10px] text-muted-foreground mt-1">Weight of one unit, not the total parcel</p>
                  {fieldErrors.invoiceUnitWeight && (
                    <p className="text-xs text-red-600 mt-1">This field is required</p>
                  )}
                </div>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">
                  Unit Rate ({selectedCurrency})
                  <span className="text-red-400">*</span>
                </Label>
                <Input
                  type="number"
                  value={invoiceUnitRate}
                  onChange={(e) => {
                    setInvoiceUnitRate(e.target.value);
                    clearFieldError('invoiceUnitRate');
                  }}
                  placeholder="100"
                  className={fieldBorderClass('invoiceUnitRate')}
                  data-testid="input-invoice-unit-rate"
                />
                <p className="text-[10px] text-muted-foreground mt-1">
                  Declared value per unit in {selectedCurrency} — quantity × rate becomes the invoice total below
                </p>
                {fieldErrors.invoiceUnitRate && (
                  <p className="text-xs text-red-600 mt-1">This field is required</p>
                )}
              </div>
              {invoiceQty && invoiceUnitRate && (
                <div className="flex justify-between text-sm pt-2 border-t border-border">
                  <span className="text-muted-foreground">Total</span>
                  <span className="font-semibold">
                    {selectedCurrency}{' '}
                    {(parseFloat(invoiceQty || '0') * parseFloat(invoiceUnitRate || '0')).toFixed(2)}
                  </span>
                </div>
              )}
            </div>

            <div className="lg:hidden space-y-4">
            {submitError && (
              <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-xl p-3">
                <AlertTriangle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
                <p className="text-xs text-red-600">{submitError}</p>
              </div>
            )}

            <Button
              onClick={handleSubmit}
              disabled={createMutation.isPending || !selectedService}
              className="w-full h-12 bg-[#F2A123] hover:bg-[#F2A123]/90 text-[lab(34.0831_-9.57756_-27.7093)] text-sm font-semibold rounded-xl shadow-[0_4px_20px_oklch(17%_0.048_248_/_0.10)] disabled:opacity-70"
              data-testid="button-submit-shipment"
            >
              {createMutation.isPending ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                'Review & Book'
              )}
            </Button>
            </div>
          </div>
        )}
        </div>{/* end lg:col-span-7 */}

        {/* RIGHT PANE — desktop only */}
        <div className="hidden lg:block lg:col-span-5">
          <div className="sticky top-6 space-y-4">
            {currentStep < 4 && (
              <div className="bg-white rounded-2xl border border-[#E2E8F0] overflow-hidden shadow-[0_2px_12px_oklch(17%_0.048_248_/_0.06),_0_1px_3px_oklch(17%_0.048_248_/_0.04)]">
                <div className="px-5 py-3.5 border-b border-[#E2E8F0] flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-bold tracking-[0.14em] uppercase text-[#F2A123]">Draft</span>
                    <span className="text-[11px] text-muted-foreground tabular-nums">{currentStep}/{steps.length}</span>
                  </div>
                  <span className="text-[11px] text-muted-foreground">Auto-saved</span>
                </div>

                {/* Sender section */}
                <div className="px-5 py-4 border-b border-[#E2E8F0]">
                  <div className="flex items-center gap-2 mb-2">
                    <div className={cn(
                      'w-5 h-5 rounded-full flex items-center justify-center shrink-0',
                      senderName.trim() ? 'bg-emerald-500 text-white' : currentStep === 1 ? 'bg-[#F2A123]/15 text-[#F2A123] border border-[#F2A123]/30' : 'bg-[#F3F4F6] text-muted-foreground'
                    )}>
                      {senderName.trim() ? <Check className="w-3 h-3" strokeWidth={3} /> : <span className="text-[10px] font-bold tabular-nums">1</span>}
                    </div>
                    <p className="text-[11px] font-bold tracking-[0.12em] uppercase text-muted-foreground">Sender</p>
                  </div>
                  <div className="pl-7">
                    {senderName.trim() ? (
                      <>
                        <p className="text-sm font-semibold text-foreground truncate">{senderName}</p>
                        <p className="text-[11px] text-muted-foreground truncate mt-0.5">
                          {[senderCity, senderState].filter(Boolean).join(', ') || 'India'}
                        </p>
                      </>
                    ) : (
                      <p className="text-[12px] text-muted-foreground italic">Pickup address — not added yet</p>
                    )}
                  </div>
                </div>

                {/* Receiver section */}
                <div className="px-5 py-4 border-b border-[#E2E8F0]">
                  <div className="flex items-center gap-2 mb-2">
                    <div className={cn(
                      'w-5 h-5 rounded-full flex items-center justify-center shrink-0',
                      receiverName.trim() ? 'bg-emerald-500 text-white' : currentStep === 2 ? 'bg-[#F2A123]/15 text-[#F2A123] border border-[#F2A123]/30' : 'bg-[#F3F4F6] text-muted-foreground'
                    )}>
                      {receiverName.trim() ? <Check className="w-3 h-3" strokeWidth={3} /> : <span className="text-[10px] font-bold tabular-nums">2</span>}
                    </div>
                    <p className="text-[11px] font-bold tracking-[0.12em] uppercase text-muted-foreground">Receiver</p>
                  </div>
                  <div className="pl-7">
                    {receiverName.trim() ? (
                      <>
                        <p className="text-sm font-semibold text-foreground truncate">{receiverName}</p>
                        <p className="text-[11px] text-muted-foreground truncate mt-0.5">
                          {[receiverCity, destinationCountry].filter(Boolean).join(' · ') || 'Destination not set'}
                        </p>
                      </>
                    ) : (
                      <p className="text-[12px] text-muted-foreground italic">Delivery address — not added yet</p>
                    )}
                  </div>
                </div>

                {/* Package section */}
                <div className="px-5 py-4">
                  <div className="flex items-center gap-2 mb-2">
                    <div className={cn(
                      'w-5 h-5 rounded-full flex items-center justify-center shrink-0',
                      (weight && parseFloat(weight) > 0) ? 'bg-emerald-500 text-white' : currentStep === 3 ? 'bg-[#F2A123]/15 text-[#F2A123] border border-[#F2A123]/30' : 'bg-[#F3F4F6] text-muted-foreground'
                    )}>
                      {(weight && parseFloat(weight) > 0) ? <Check className="w-3 h-3" strokeWidth={3} /> : <span className="text-[10px] font-bold tabular-nums">3</span>}
                    </div>
                    <p className="text-[11px] font-bold tracking-[0.12em] uppercase text-muted-foreground">Package</p>
                  </div>
                  <div className="pl-7 space-y-1.5">
                    {(weight && parseFloat(weight) > 0) ? (
                      <>
                        <p className="text-sm font-semibold text-foreground tabular-nums">
                          {weight} {weightUnit}
                          {dimL && dimW && dimH ? <span className="text-muted-foreground font-medium"> · {dimL}×{dimW}×{dimH}{dimUnit}</span> : null}
                        </p>
                        {shipmentValue ? (
                          <p className="text-[11px] text-muted-foreground tabular-nums">Value: {selectedCurrency} {shipmentValue}</p>
                        ) : null}
                        {packagingRequired ? (
                          <p className="text-[11px] text-muted-foreground">Packaging: we pack it</p>
                        ) : null}
                      </>
                    ) : (
                      <p className="text-[12px] text-muted-foreground italic">Weight, dimensions &amp; value — not set</p>
                    )}
                  </div>
                </div>

                <div className="px-5 py-3 bg-[#F8F9FA] border-t border-[#E2E8F0]">
                  <p className="text-[11px] text-muted-foreground leading-relaxed">
                    Complete all three steps to get a live rate quote.
                  </p>
                </div>
              </div>
            )}

            {currentStep === 4 && (
              <div className="space-y-4">
                <Button
                  type="button"
                  onClick={handleOpenServiceModal}
                  disabled={!productType.trim() || rateMutation.isPending}
                  className="w-full h-12 bg-[#F2A123] hover:bg-[#F2A123]/90 text-[lab(34.0831_-9.57756_-27.7093)] text-sm font-semibold rounded-xl shadow-[0_4px_20px_oklch(17%_0.048_248_/_0.10)] disabled:opacity-70 flex items-center justify-center gap-2"
                >
                  {rateMutation.isPending ? (
                    <Loader2 className="w-5 h-5 animate-spin" />
                  ) : (
                    <>
                      <Zap className="w-4 h-4 shrink-0" aria-hidden />
                      {selectedService ? 'Change Service' : 'Get Rates'}
                    </>
                  )}
                </Button>

                {ratesError ? (
                  <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-xl p-3">
                    <AlertTriangle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
                    <p className="text-xs text-red-600">{ratesError}</p>
                  </div>
                ) : null}

                {selectedService && (
                  <div className="bg-white rounded-xl border border-[#E2E8F0] p-4 space-y-1.5 shadow-[0_2px_12px_oklch(17%_0.048_248_/_0.06)]">
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">Selected service</p>
                    <p className="font-semibold text-sm text-[lab(34.0831_-9.57756_-27.7093)]">{selectedService.internal_api_service_code || selectedService.code}</p>
                    <p className="font-mono text-lg font-semibold text-[#2F4468]">{formatInr(selectedService.total)}</p>
                    <p className="text-[10px] text-muted-foreground">incl. GST · estimated</p>
                  </div>
                )}

                {serviceSelectionError ? (
                  <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-xl p-3">
                    <AlertTriangle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
                    <p className="text-xs text-red-600">{serviceSelectionError}</p>
                  </div>
                ) : null}

                {submitError && (
                  <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-xl p-3">
                    <AlertTriangle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
                    <p className="text-xs text-red-600">{submitError}</p>
                  </div>
                )}

                <Button
                  onClick={handleSubmit}
                  disabled={createMutation.isPending || !selectedService}
                  className="w-full h-12 bg-[#F2A123] hover:bg-[#F2A123]/90 text-[lab(34.0831_-9.57756_-27.7093)] text-sm font-semibold rounded-xl shadow-[0_4px_20px_oklch(17%_0.048_248_/_0.10)] disabled:opacity-70"
                  data-testid="button-submit-shipment-desktop"
                >
                  {createMutation.isPending ? (
                    <Loader2 className="w-5 h-5 animate-spin" />
                  ) : (
                    'Create Shipment'
                  )}
                </Button>
              </div>
            )}
          </div>
        </div>
      </main>

      <BottomNav />

      {showProductTypeInfo && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4"
          onClick={() => setShowProductTypeInfo(false)}
        >
          <div
            className="bg-white rounded-2xl p-5 max-w-sm w-full shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-base text-gray-900">Product Types</h3>
              <button
                type="button"
                onClick={() => setShowProductTypeInfo(false)}
                className="text-gray-400 hover:text-gray-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-4">
              {productTypeOptions.map(({ value }) => {
                const info = PRODUCT_TYPE_INFO[value];
                if (!info) return null;
                return (
                  <div key={value}>
                    <p className="font-medium text-sm text-gray-900 mb-0.5">{info.title}</p>
                    <p className="text-xs text-gray-500 leading-relaxed">{info.body}</p>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {showServiceModal && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/50"
          onClick={() => setShowServiceModal(false)}
          role="presentation"
        >
          <div
            className="w-full max-w-lg bg-white rounded-t-2xl max-h-[85vh] flex flex-col shadow-xl"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="service-sheet-title"
          >
            <div className="flex justify-center pt-3 pb-1 shrink-0">
              <div className="w-10 h-1 bg-gray-200 rounded-full" />
            </div>
            <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
              <h3 id="service-sheet-title" className="font-semibold text-base text-gray-900">
                Select a Shipping Service
              </h3>
              <button
                type="button"
                onClick={() => setShowServiceModal(false)}
                className="w-7 h-7 rounded-full bg-gray-100 flex items-center justify-center text-gray-500 hover:bg-gray-200 transition-colors"
                aria-label="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="overflow-y-auto p-4" style={ratesResultsShellStyle} data-testid="invoice-rate-results">
              {rateMutation.isPending ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                </div>
              ) : displayRates.length > 0 ? (
                <div className="flex flex-col gap-[10px]">
                  {displayRates.map((service, idx) => {
                    const isBest = idx === 0;
                    const displayName = service.code || service.internal_api_service_code || 'Service';
                    const letter = displayName.trim().charAt(0).toUpperCase() || '?';
                    const gstTotal = service.cgst + service.sgst;
                    const open = !!expandedById[service.id];
                    const weightStr =
                      service.weight?.trim() || String(getWeightKg().toFixed(2));
                    const itemizedEmpty = itemizedChargesEmpty(service);
                    const showOtherChargesAggregate =
                      service.other_charges > 0 && itemizedEmpty;
                    const isSelected = pendingService?.id === service.id;

                    const toggle = (): void => {
                      setExpandedById((prev) => ({
                        ...prev,
                        [service.id]: !prev[service.id],
                      }));
                    };

                    return (
                      <div
                        key={service.id}
                        role="button"
                        tabIndex={0}
                        onClick={() => setPendingService(service)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            setPendingService(service);
                          }
                        }}
                        className={cn(
                          'rounded-xl border border-[#E2E8F0] bg-white overflow-hidden relative outline-none focus-visible:ring-2 focus-visible:ring-[#2F4468] cursor-pointer shadow-[0_2px_12px_oklch(17%_0.048_248_/_0.06),_0_1px_3px_oklch(17%_0.048_248_/_0.04)]',
                          isSelected && 'ring-2 ring-[#F2A123] border-[#F2A123]'
                        )}
                        data-testid={`invoice-rate-card-${idx}`}
                      >
                        {isSelected ? (
                          <div className="absolute top-3 right-3 z-10 rounded-full bg-[#F2A123] p-0.5 text-[lab(34.0831_-9.57756_-27.7093)]">
                            <Check className="w-3.5 h-3.5" strokeWidth={3} aria-hidden />
                          </div>
                        ) : null}
                        <div className="flex items-center gap-3 px-4 pt-[14px] pb-3">
                          <div
                            className="w-[34px] h-[34px] shrink-0 rounded-[10px] flex items-center justify-center text-[13px] font-medium text-white"
                            style={{ backgroundColor: isBest ? BEST_GREEN : '#2F4468' }}
                          >
                            {letter}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="text-[13px] font-semibold text-[lab(34.0831_-9.57756_-27.7093)] leading-snug">
                              {displayName}
                            </p>
                            <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                              <span className="text-[11px] text-muted-foreground">
                                {weightStr} kg chargeable
                              </span>
                              {isBest ? (
                                <span
                                  className="inline-block rounded-[20px] px-[7px] py-0.5 text-[9px] font-medium"
                                  style={{ backgroundColor: BEST_BADGE_BG, color: BEST_GREEN }}
                                >
                                  Best value
                                </span>
                              ) : null}
                            </div>
                          </div>
                          <div className="shrink-0 text-right pr-6">
                            <p className="text-[20px] font-semibold tabular-nums font-mono text-[#2F4468]">
                              {formatInr(service.total)}
                            </p>
                            <p className="text-[10px] text-muted-foreground">incl. GST</p>
                          </div>
                        </div>

                        <div className="h-[0.5px] bg-[#E2E8F0]" />

                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            toggle();
                          }}
                          className="w-full flex items-center justify-between px-4 py-2 text-left hover:bg-black/[0.02] transition-colors"
                        >
                          <span className="text-[11px] text-muted-foreground">
                            {open ? 'Hide breakdown' : 'View price breakdown'}
                          </span>
                          <ChevronDown
                            className={cn(
                              'w-[11px] h-[11px] text-muted-foreground shrink-0 transition-transform duration-200',
                              open && 'rotate-180'
                            )}
                          />
                        </button>

                        {open ? (
                          <div className="bg-[var(--color-background-secondary)] px-4 py-3 border-t-[0.5px] border-[var(--color-border-tertiary)]">
                            <div className="space-y-2">
                              <div className="flex justify-between gap-3 text-[11px]">
                                <span className="text-muted-foreground">Base rate</span>
                                <span className="font-medium tabular-nums">{formatInr(service.rate)}</span>
                              </div>
                              {service.fsc !== 0 ? (
                                <div className="flex justify-between gap-3 text-[11px]">
                                  <span className="text-muted-foreground">Fuel surcharge (FSC)</span>
                                  <span className="font-medium tabular-nums">{formatInr(service.fsc)}</span>
                                </div>
                              ) : null}
                              {!itemizedEmpty
                                ? Object.values(service.chrage_apply_data!)
                                    .filter((entry) => entry.amount !== 0)
                                    .map((entry, i) => (
                                      <div
                                        key={`${service.id}-chg-${i}`}
                                        className="flex justify-between gap-3 text-[11px]"
                                      >
                                        <span className="text-muted-foreground">{entry.name}</span>
                                        <span className="font-medium tabular-nums">
                                          {formatInr(entry.amount)}
                                        </span>
                                      </div>
                                    ))
                                : null}
                              {showOtherChargesAggregate ? (
                                <div className="flex justify-between gap-3 text-[11px]">
                                  <span className="text-muted-foreground">Other charges</span>
                                  <span className="font-medium tabular-nums">
                                    {formatInr(service.other_charges)}
                                  </span>
                                </div>
                              ) : null}
                            </div>

                            <div className="my-3 h-[0.5px] bg-[#E2E8F0]" />

                            <div className="space-y-2">
                              {service.sub_total !== 0 ? (
                                <div className="flex justify-between gap-3 text-[11px]">
                                  <span className="text-muted-foreground">Sub-total</span>
                                  <span className="font-medium tabular-nums">
                                    {formatInr(service.sub_total)}
                                  </span>
                                </div>
                              ) : null}
                              {gstTotal !== 0 ? (
                                <div className="flex justify-between gap-3 text-[11px]">
                                  <span className="text-muted-foreground">
                                    GST ({service.gst_per || '0'}%)
                                  </span>
                                  <span className="font-medium tabular-nums">{formatInr(gstTotal)}</span>
                                </div>
                              ) : null}
                            </div>

                            <div className="my-3 h-px bg-[#E2E8F0] opacity-80" />

                            <div className="flex justify-between gap-3 items-baseline">
                              <span className="text-[11px] text-muted-foreground">Total payable</span>
                              <span className="text-[13px] font-semibold tabular-nums font-mono text-[#2F4468]">
                                {formatInr(service.total)}
                              </span>
                            </div>
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground text-center py-4 px-2">
                  No rates available for this selection
                </p>
              )}

              <p className="text-[10px] text-muted-foreground text-center mt-4">
                Estimated only. Final charges may vary.
              </p>
            </div>

            <div className="p-4 border-t border-border shrink-0">
              <Button
                onClick={() => {
                  if (!pendingService) return;
                  setSelectedService(pendingService);
                  setServiceSelectionError('');
                  setShowServiceModal(false);
                }}
                disabled={!pendingService}
                className="w-full h-12 bg-[#F2A123] hover:bg-[#F2A123]/90 text-[lab(34.0831_-9.57756_-27.7093)] text-sm font-semibold rounded-xl shadow-[0_4px_20px_oklch(17%_0.048_248_/_0.10)] disabled:opacity-70"
                data-testid="button-confirm-service"
              >
                {pendingService ? 'Confirm Selection' : 'Select a service to continue'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {pickupDatePickerOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/50"
          onClick={() => setPickupDatePickerOpen(false)}
          role="presentation"
        >
          <div
            className="w-full max-w-lg bg-white rounded-t-2xl max-h-[80vh] overflow-y-auto shadow-xl"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="pickup-date-sheet-title"
          >
            <div className="flex justify-center pt-3 pb-1">
              <div className="w-10 h-1 bg-gray-200 rounded-full" />
            </div>
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <h3 id="pickup-date-sheet-title" className="font-semibold text-base text-gray-900">
                Choose pickup date
              </h3>
              <button
                type="button"
                onClick={() => setPickupDatePickerOpen(false)}
                className="w-7 h-7 rounded-full bg-gray-100 flex items-center justify-center text-gray-500 hover:bg-gray-200 transition-colors"
                aria-label="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-4">
              <Calendar
                mode="single"
                selected={pickupDate ? new Date(`${pickupDate}T00:00:00`) : undefined}
                onSelect={(date) => {
                  if (!date) return;
                  const iso = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
                  setPickupDate(iso);
                  clearFieldError('pickupDate');
                  setPickupDatePickerOpen(false);
                }}
                // Everything before the earliest bookable date is off, which
                // is today's date up to 3 PM IST and tomorrow's after it.
                disabled={{ before: new Date(`${earliestDate}T00:00:00`) }}
                autoFocus
                className="w-full [--cell-size:2.75rem]"
                classNames={{ root: 'w-full' }}
              />
              {/* Say why today is greyed out. An unexplained disabled date
                  reads as a bug; a reason reads as a fact. */}
              {cutoffPassed && (
                <p
                  className="text-xs text-muted-foreground mt-3 text-center"
                  data-testid="text-pickup-cutoff"
                >
                  Bookings made after {PICKUP_CUTOFF_HOUR % 12 || 12}{' '}
                  {PICKUP_CUTOFF_HOUR >= 12 ? 'PM' : 'AM'} are collected from the next day.
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {showConfirmModal && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 px-0 sm:px-4"
          onClick={() => !createMutation.isPending && setShowConfirmModal(false)}
        >
          <div
            className="bg-white rounded-t-2xl sm:rounded-2xl p-5 max-w-sm w-full shadow-xl max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
            data-testid="modal-confirm-booking"
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-base text-gray-900">Review &amp; Pay</h3>
              <button
                type="button"
                onClick={() => setShowConfirmModal(false)}
                className="text-gray-400 hover:text-gray-600"
                data-testid="button-close-confirm-modal"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="bg-muted/30 rounded-xl border border-border p-4 space-y-2 text-sm mb-5">
              <div className="flex justify-between gap-3">
                <span className="text-muted-foreground">Service</span>
                <span className="font-medium text-foreground text-right text-xs break-words">
                  {selectedService
                    ? selectedService.internal_api_service_code || selectedService.code
                    : '—'}
                </span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-muted-foreground">
                  {pickupRequest === '1' ? 'Pickup' : 'Drop-off'}
                </span>
                <span className="font-medium text-foreground text-right">
                  {pickupRequest === '1' ? pickupDate : 'At the hub'}
                </span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-muted-foreground">Packaging</span>
                <span className="font-medium text-foreground text-right">
                  {packagingRequired ? 'We pack it' : 'Already packed'}
                </span>
              </div>
              <div className="flex justify-between gap-3 pt-2 border-t border-border">
                <span className="text-muted-foreground font-medium">Total</span>
                <span className="font-mono text-base font-semibold text-[#2F4468]">
                  {selectedService ? formatInr(selectedService.total) : '—'}
                </span>
              </div>
              <p className="text-[10px] text-muted-foreground">incl. GST · estimated, settled after weighing</p>
            </div>

            <Label className="text-xs text-muted-foreground mb-2 block">Pay with</Label>
            <div className="space-y-2 mb-5">
              {paymentMethodOptions.map(([val, label]) => (
                <label
                  key={val}
                  className={cn(
                    'flex items-center gap-3 px-3 py-2.5 rounded-xl border cursor-pointer transition-colors',
                    paymentMethod === val ? 'border-primary bg-primary/5' : 'border-border'
                  )}
                >
                  <input
                    type="radio"
                    name="payment_method"
                    checked={paymentMethod === val}
                    onChange={() => {
                      setPaymentMethod(val);
                      setPaymentError('');
                    }}
                    className="accent-primary"
                    data-testid={`radio-payment-method-${val}`}
                  />
                  <span className="text-sm text-foreground">{label}</span>
                </label>
              ))}
            </div>

            {/* TEMPORARY — only renders when the server has PAYMENTS_TEST_MODE
                set. Sits under the method it affects, because it changes what
                "Pay Now" does. */}
            {paymentMethod === 'pay_now' && <PaymentTestModeSwitch className="mb-4" />}

            {paymentError && (
              <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-xl p-3 mb-4">
                <AlertTriangle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
                <p className="text-xs text-red-600">{paymentError}</p>
              </div>
            )}

            <Button
              onClick={handleConfirmBooking}
              disabled={createMutation.isPending}
              className="w-full h-12 bg-[#F2A123] hover:bg-[#F2A123]/90 text-[lab(34.0831_-9.57756_-27.7093)] text-sm font-semibold rounded-xl shadow-[0_4px_20px_oklch(17%_0.048_248_/_0.10)] disabled:opacity-70"
              data-testid="button-confirm-booking"
            >
              {createMutation.isPending ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Confirm Booking'}
            </Button>
          </div>
        </div>
      )}

      <DimensionPresetSheet
        open={showPresetSheet}
        onClose={() => setShowPresetSheet(false)}
        selectedPreset={selectedPreset}
        onSelectPreset={(id, l, w, h) => {
          setSelectedPreset(id);
          setDimL(l);
          setDimW(w);
          setDimH(h);
          if (l) clearFieldError('dimL');
          if (w) clearFieldError('dimW');
          if (h) clearFieldError('dimH');
        }}
        dimUnit={dimUnit}
      />
    </div>
  );
}

