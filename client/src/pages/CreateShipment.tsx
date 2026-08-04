import { lazy, Suspense, useState, useEffect, useMemo, useLayoutEffect, type CSSProperties } from 'react';
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
} from 'lucide-react';
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
import { Shipment, TrackingEvent, lbToKg, inToCm } from '@/lib/mockData';
import { apiRequest } from '@/lib/queryClient';
import { cn } from '@/lib/utils';
import {
  base64ToPdfFile,
  canSharePdfFile,
  downloadPdfBlob,
  openPdfOverlayOrDownload,
} from '@/lib/pdfUtils';
import { pickShipmentDocument, type ItdLabelEntry } from '@/lib/shipmentDocuments';
import { isAndroid } from '@/lib/platform';
import { shareViaCapacitor } from '@/lib/nativeShare';
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

const PdfCanvasViewer = lazy(() => import('@/components/PdfCanvasViewer'));

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

interface CreateShipmentResponse {
  success: boolean;
  errors: string[];
  data: {
    docket_id: number;
    awb_no: string;
  };
  labels?: ItdLabelEntry[];
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

export default function CreateShipment() {
  const [, setLocation] = useLocation();
  const { isLoggedIn, user, addShipment, addNotification, logout } = useAppStore();
  const [currentStep, setCurrentStep] = useState(1);
  const [newAWB, setNewAWB] = useState('');
  const [shipmentLabel, setShipmentLabel] = useState<string | null>(null);
  const [shipmentBoxLabel, setShipmentBoxLabel] = useState<string | null>(null);
  const [shipmentPostalLabel, setShipmentPostalLabel] = useState<string | null>(null);
  const [shipmentInvoice, setShipmentInvoice] = useState<string | null>(null);
  const [pdfDataUrl, setPdfDataUrl] = useState<string | null>(null);
  const [pdfTitle, setPdfTitle] = useState('Shipment Label');
  const [submitError, setSubmitError] = useState('');

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

  const [kycResult, setKycResult] = useState<KycUploadResult | null>(null);

  const { data: kycOnFile } = useKycOnFile({ enabled: isLoggedIn });

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
      fieldErrors[key] && 'border-2 border-primary'
    );

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
    if (!newAWB) return;
    confetti({
      particleCount: 120,
      spread: 70,
      origin: { x: 0.5, y: 0.5 },
      startVelocity: 40,
      colors: ['#14567C', '#ffffff'],
    });
  }, [newAWB]);

  useEffect(() => {
    if (!selectedPreset) return;
    const preset = DIMENSION_PRESETS.find((p) => p.id === selectedPreset);
    if (!preset) return;
    const vals = dimUnit === 'cm' ? preset.cm : preset.in;
    setDimL(vals.l);
    setDimW(vals.w);
    setDimH(vals.h);
  }, [dimUnit, selectedPreset]);

  const createMutation = useMutation({
    mutationFn: (payload: CreateShipmentPayload) =>
      apiRequest('POST', '/api/shipments', payload).then((r) => r.json() as Promise<CreateShipmentResponse>),
    onSuccess: (data) => {
      if (!data.success) {
        setSubmitError(data.errors?.join(', ') || 'Shipment creation failed');
        return;
      }
      const awb = data.data.awb_no;
      const labelStr = pickShipmentDocument(data.labels, 'label');
      setShipmentLabel(labelStr);
      setShipmentBoxLabel(pickShipmentDocument(data.labels, 'boxLabel'));
      setShipmentPostalLabel(pickShipmentDocument(data.labels, 'postalLabel'));
      const invoiceStr = pickShipmentDocument(data.labels, 'invoice');
      setShipmentInvoice(invoiceStr);
      const now = new Date();
      const w = parseFloat(weight) || 1;
      const weightLb = weightUnit === 'lb' ? w : w / 0.453592;
      const weightKg = weightUnit === 'kg' ? w : lbToKg(w);

      let dimLIn: number | undefined;
      let dimWIn: number | undefined;
      let dimHIn: number | undefined;
      let dimLCm: number | undefined;
      let dimWCm: number | undefined;
      let dimHCm: number | undefined;

      if (dimL || dimW || dimH) {
        if (dimUnit === 'in') {
          dimLIn = parseFloat(dimL) || undefined;
          dimWIn = parseFloat(dimW) || undefined;
          dimHIn = parseFloat(dimH) || undefined;
          dimLCm = dimLIn ? inToCm(dimLIn) : undefined;
          dimWCm = dimWIn ? inToCm(dimWIn) : undefined;
          dimHCm = dimHIn ? inToCm(dimHIn) : undefined;
        } else {
          dimLCm = parseFloat(dimL) || undefined;
          dimWCm = parseFloat(dimW) || undefined;
          dimHCm = parseFloat(dimH) || undefined;
          dimLIn = dimLCm ? dimLCm / 2.54 : undefined;
          dimWIn = dimWCm ? dimWCm / 2.54 : undefined;
          dimHIn = dimHCm ? dimHCm / 2.54 : undefined;
        }
      }

      const eta = new Date();
      eta.setDate(eta.getDate() + 5); // Bombino Premium DDP is express-grade

      const trackingEvents: TrackingEvent[] = [{
        id: `event-${Math.random().toString(36).slice(2)}`,
        status: 'Pickup Scheduled',
        note: 'Shipment pickup has been scheduled',
        location: `${senderCity}, ${senderState}, India`,
        timestamp: now,
      }];

      const shipment: Shipment = {
        id: Math.random().toString(36).slice(2),
        awb,
        userId: user?.id ?? '',
        originCountry: 'India',
        originCity: senderCity,
        originState: senderState,
        originZip: senderZip,
        destCountry: formatCountryDisplay(
          ITD_COUNTRY_MAP[destinationCountry]?.name ?? destinationCountry
        ),
        destCity: receiverCity,
        destState: receiverState,
        destPincode: receiverZip,
        weightLb: parseFloat(weightLb.toFixed(1)),
        weightKg: parseFloat(weightKg.toFixed(2)),
        pieces: parseInt(pieces) || 1,
        dimLIn, dimWIn, dimHIn, dimLCm, dimWCm, dimHCm,
        productType: 'Package' as const,
        serviceType: 'Express' as const,
        status: 'Pickup Scheduled',
        priceEstimate: 0,
        eta,
        lastUpdateAt: now,
        createdAt: now,
        currency: selectedCurrency,
        trackingEvents,
      };

      addShipment(shipment);
      addNotification({
        id: `notif-${Math.random().toString(36).slice(2)}`,
        userId: user?.id ?? '',
        title: 'Shipment Created',
        body: `Your shipment ${awb} has been created.`,
        severity: 'info',
        createdAt: now,
      });

      setNewAWB(awb);
    },
    onError: (err) => {
      const message = err instanceof Error ? err.message : 'Shipment creation failed';

      // A 401 is handled centrally — the interceptor in lib/session.ts has
      // already cleared the session and started the redirect by the time this
      // runs. Say nothing here: a toast about a failed booking would be the
      // last thing on screen before the page navigates away, and the expiry
      // notice on /login is the honest version of it.
      if (err instanceof Error && /^401:/.test(err.message)) {
        return;
      }

      // All other errors — existing behavior
      const msg = message.replace(/^\d+:\s*/, '');
      setSubmitError(msg);
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

  const handleDownloadLabel = (base64: string) => {
    setPdfTitle('Shipment Label');
    const dataUrl = `data:application/pdf;base64,${base64}`;
    setPdfDataUrl(dataUrl);
  };

  const handleViewBoxLabel = (): void => {
    if (!shipmentBoxLabel) return;
    openPdfOverlayOrDownload(
      shipmentBoxLabel,
      'box-label.pdf',
      'Box Label',
      setPdfTitle,
      setPdfDataUrl
    );
  };

  const handleViewPostalLabel = (): void => {
    if (!shipmentPostalLabel) return;
    openPdfOverlayOrDownload(
      shipmentPostalLabel,
      'postal-label.pdf',
      'Postal Label',
      setPdfTitle,
      setPdfDataUrl
    );
  };

  const handleViewInvoice = (): void => {
    if (!shipmentInvoice) return;
    openPdfOverlayOrDownload(
      shipmentInvoice,
      'shipment-invoice.pdf',
      'Shipment Invoice',
      setPdfTitle,
      setPdfDataUrl
    );
  };

  const handleShareLabel = async (dataUrl: string) => {
    try {
      const base64 = dataUrl.split(',')[1];
      const fileName = pdfTitle.includes('Invoice')
        ? 'shipment-invoice.pdf'
        : pdfTitle.includes('Box')
          ? 'box-label.pdf'
          : pdfTitle.includes('Postal')
            ? 'postal-label.pdf'
            : 'shipment-label.pdf';
      const shareTitle = pdfTitle;

      if (isAndroid()) {
        const ok = await shareViaCapacitor(base64, fileName, shareTitle);
        if (ok) return;
      }

      const file = base64ToPdfFile(base64, fileName);

      if (canSharePdfFile(file)) {
        await navigator.share({
          files: [file],
          title: shareTitle,
        });
      } else if (!isAndroid()) {
        downloadPdfBlob(file, fileName);
      }
      // Android with no native plugin: silent no-op (as today)
    } catch (err) {
      if (err instanceof Error && err.name !== 'AbortError') {
        toast({
          title: 'Share failed',
          description: 'Could not share the label.',
          variant: 'destructive',
        });
      }
    }
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

  if (newAWB) {
    const bookingDateLabel = new Date().toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
    const corridorLabel = `${senderCity}, ${senderState} → ${receiverCity}, ${receiverState}`;

    const copyAwb = (): void => {
      void navigator.clipboard.writeText(newAWB).then(() => {
        toast({ title: 'Copied', description: 'AWB copied to clipboard' });
      });
    };

    return (
      <div className="min-h-[100dvh] bg-background pb-nav" data-testid="screen-create-success">
        {pdfDataUrl && (
          <div className="fixed inset-0 z-[100] bg-white flex flex-col">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-white safe-top">
              <span className="font-semibold text-sm text-foreground">
                {pdfTitle}
              </span>
              <button
                type="button"
                onClick={() => void handleShareLabel(pdfDataUrl)}
                className="text-sm text-[#14567C] font-medium"
              >
                Share
              </button>
              <button
                type="button"
                onClick={() => setPdfDataUrl(null)}
                className="text-sm text-[#14567C] font-medium"
              >
                Close
              </button>
            </div>
            {isAndroid() ? (
              <Suspense
                fallback={
                  <div className="flex-1 grid place-items-center text-sm text-muted-foreground">
                    Loading PDF…
                  </div>
                }
              >
                <PdfCanvasViewer base64={pdfDataUrl.split(',')[1]} title={pdfTitle} />
              </Suspense>
            ) : (
              <iframe
                src={pdfDataUrl}
                className="flex-1 w-full border-0"
                title={pdfTitle}
              />
            )}
          </div>
        )}
        <main className="px-4 py-12 max-w-md mx-auto text-center">
          <div className="w-20 h-20 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-5 animate-scale-in">
            <Check className="w-10 h-10 text-[#14567C]" strokeWidth={2.5} />
          </div>
          <h2 className="text-2xl font-bold text-foreground mb-2">Shipment Booked!</h2>
          <p className="text-sm text-muted-foreground mb-6">
            Your shipment has been successfully created.
          </p>

          <div className="bg-card rounded-xl border border-border p-4 mb-6 text-left shadow-sm w-full">
            <button
              type="button"
              onClick={copyAwb}
              className="w-full text-left rounded-lg p-2 -m-2 hover:bg-muted/50 transition-colors active:scale-[0.99]"
              data-testid="button-copy-awb"
            >
              <p className="text-xs text-muted-foreground mb-1">AWB Number · tap to copy</p>
              <div className="flex items-center justify-between gap-2">
                <p className="text-lg font-bold text-foreground break-all">{newAWB}</p>
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
              <div>
                <p className="text-muted-foreground text-xs mb-1">From → To</p>
                <p className="font-medium text-foreground text-sm leading-snug">{corridorLabel}</p>
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <Button
              onClick={() => setLocation(`/shipment/${encodeURIComponent(newAWB)}`)}
              className="w-full h-12 bg-primary hover:bg-primary/90 text-sm rounded-xl shadow-md flex items-center justify-center gap-2"
              data-testid="button-view-label"
            >
              <FileText className="w-4 h-4" />
              View Label & Details
            </Button>
            {shipmentBoxLabel && (
              <Button
                variant="outline"
                onClick={handleViewBoxLabel}
                className="w-full h-12 text-sm rounded-xl border-[#14567C] text-[#14567C] flex items-center justify-center gap-2"
                data-testid="button-view-box-label"
              >
                <FileText className="w-4 h-4" />
                View Box Label
              </Button>
            )}
            {shipmentPostalLabel && (
              <Button
                variant="outline"
                onClick={handleViewPostalLabel}
                className="w-full h-12 text-sm rounded-xl border-[#14567C] text-[#14567C] flex items-center justify-center gap-2"
                data-testid="button-view-postal-label"
              >
                <FileText className="w-4 h-4" />
                View Postal Label
              </Button>
            )}
            {shipmentInvoice && (
              <Button
                variant="outline"
                onClick={handleViewInvoice}
                className="w-full h-12 text-sm rounded-xl border-[#14567C] text-[#14567C] flex items-center justify-center gap-2"
                data-testid="button-view-invoice"
              >
                <FileText className="w-4 h-4" />
                View Invoice
              </Button>
            )}
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
      if (!kycOnFile && !kycResult) e.kycMissing = true;
      if (Object.keys(e).length) {
        setFieldErrors(e);
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
        return;
      }
      const trimmedContent = shipmentContent.trim();
      setHsCode(trimmedContent ? (getHsnCode(trimmedContent) || '') : '');
    }
    if (currentStep < 4) setCurrentStep(currentStep + 1);
  };

  const handleBack = () => {
    setFieldErrors({});
    setStepError('');
    if (currentStep > 1) {
      setCurrentStep(currentStep - 1);
    } else {
      setLocation('/home');
    }
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
    setShipmentLabel(null);
    setShipmentInvoice(null);
    setPdfDataUrl(null);
    setPdfTitle('Shipment Label');
    if (!productType.trim()) {
      setSubmitError('Please select a product type');
      return;
    }
    if (!selectedService) {
      setServiceSelectionError('Please select a shipping service');
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
        return;
      }
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

    createMutation.mutate(payload);
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
                  <Label className="text-xs text-muted-foreground">Phone</Label>
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

            {kycOnFile ? (
              <KycOnFileCard kyc={kycOnFile} />
            ) : (
              <KycUpload
                onValidChange={setKycResult}
                fieldErrors={{
                  document_no: !!fieldErrors.kycMissing,
                  file: !!fieldErrors.kycMissing,
                }}
              />
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
                <Label className="text-xs text-muted-foreground">Phone</Label>
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
                  <Label className="text-xs text-muted-foreground">Weight ({weightUnit})</Label>
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
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <Label className="text-xs text-muted-foreground">L</Label>
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
                  <Label className="text-xs text-muted-foreground">W</Label>
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
                  <Label className="text-xs text-muted-foreground">H</Label>
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
                  <Label className="text-xs text-muted-foreground">Declared Value</Label>
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
                    onValueChange={(v) => {
                      setProductType(v);
                      setRateResults(null);
                      setSelectedService(null);
                      setRatesError('');
                      setServiceSelectionError('');
                      if (v !== 'CSB V') {
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
                    }}
                  >
                    <SelectTrigger className="mt-1">
                      <SelectValue placeholder="Select product type" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="DOX">Documents</SelectItem>
                      <SelectItem value="SPX">Package</SelectItem>
                      <SelectItem value="COMMERCIAL">Commercial</SelectItem>
                      <SelectItem value="CSB V">CSB V</SelectItem>
                    </SelectContent>
                  </Select>
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
                <div className="flex justify-between text-sm gap-2">
                  <span className="text-muted-foreground shrink-0">Service</span>
                  <span className="font-medium text-foreground text-right text-xs break-words">
                    {selectedService
                      ? selectedService.internal_api_service_code || selectedService.code
                      : '—'}
                  </span>
                </div>
                {productType !== 'CSB V' && (
                  <div className="flex justify-between text-sm gap-2">
                    <span className="text-muted-foreground shrink-0">HS Code</span>
                    <span className="font-medium text-foreground text-right text-xs break-all">
                      {hsCode || '—'}
                    </span>
                  </div>
                )}
              </div>
            </div>

            <div className="lg:hidden space-y-4">
            <Button
              type="button"
              onClick={handleGetRates}
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

            {ratesError ? (
              <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-xl p-3">
                <AlertTriangle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
                <p className="text-xs text-red-600">{ratesError}</p>
              </div>
            ) : null}
            </div>

            {rateResults !== null ? (
              <div
                className="rounded-xl pb-1"
                style={ratesResultsShellStyle}
                data-testid="invoice-rate-results"
              >
                {displayRates.length > 0 ? (
                  <>
                    <h3 className="text-sm font-semibold text-foreground px-1 mb-2">
                      Select a Shipping Service
                    </h3>
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
                        const isSelected = selectedService?.id === service.id;

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
                            onClick={() => {
                              setSelectedService(service);
                              setServiceSelectionError('');
                            }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                setSelectedService(service);
                                setServiceSelectionError('');
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
                  </>
                ) : !rateMutation.isPending ? (
                  <p className="text-sm text-muted-foreground text-center py-4 px-2">
                    No rates available for this selection
                  </p>
                ) : null}

                {serviceSelectionError ? (
                  <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-xl p-3 mt-3">
                    <AlertTriangle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
                    <p className="text-xs text-red-600">{serviceSelectionError}</p>
                  </div>
                ) : null}

                <p className="text-[10px] text-muted-foreground text-center mt-4">
                  Estimated only. Final charges may vary.
                </p>
              </div>
            ) : null}

            <div className="bg-white rounded-xl border border-[#E2E8F0] p-4 space-y-3 shadow-[0_2px_12px_oklch(17%_0.048_248_/_0.06),_0_1px_3px_oklch(17%_0.048_248_/_0.04)]">
              <Label className="text-sm font-semibold">Invoice Item</Label>
              <div>
                <Label className="text-xs text-muted-foreground">Description</Label>
                <div className="h-11 mt-1 px-3 flex items-center bg-muted/50 border border-border rounded-xl text-sm text-muted-foreground">
                  {shipmentContent.trim() || 'GIFTS'}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs text-muted-foreground">Quantity</Label>
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
                  {fieldErrors.invoiceQty && (
                    <p className="text-xs text-red-600 mt-1">This field is required</p>
                  )}
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Unit Weight (kg)</Label>
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
                  {fieldErrors.invoiceUnitWeight && (
                    <p className="text-xs text-red-600 mt-1">This field is required</p>
                  )}
                </div>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Unit Rate ({selectedCurrency})</Label>
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
              disabled={createMutation.isPending}
              className="w-full h-12 bg-[#F2A123] hover:bg-[#F2A123]/90 text-[lab(34.0831_-9.57756_-27.7093)] text-sm font-semibold rounded-xl shadow-[0_4px_20px_oklch(17%_0.048_248_/_0.10)] disabled:opacity-70"
              data-testid="button-submit-shipment"
            >
              {createMutation.isPending ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                'Create Shipment'
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
                  onClick={handleGetRates}
                  disabled={!productType.trim() || rateMutation.isPending}
                  className="w-full h-12 bg-[#F2A123] hover:bg-[#F2A123]/90 text-[lab(34.0831_-9.57756_-27.7093)] text-sm font-semibold rounded-xl shadow-[0_4px_20px_oklch(17%_0.048_248_/_0.10)] disabled:opacity-70 flex items-center justify-center gap-2"
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
                  disabled={createMutation.isPending}
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
              <div>
                <p className="font-medium text-sm text-gray-900 mb-0.5">Documents (DOX)</p>
                <p className="text-xs text-gray-500 leading-relaxed">
                  Standard industry code for shipments containing only paper — no commercial value, no duties.
                </p>
              </div>
              <div>
                <p className="font-medium text-sm text-gray-900 mb-0.5">Package (SPX)</p>
                <p className="text-xs text-gray-500 leading-relaxed">
                  Small Parcel Express — usually containing physical goods that aren't just paper.
                </p>
              </div>
              <div>
                <p className="font-medium text-sm text-gray-900 mb-0.5">Commercial</p>
                <p className="text-xs text-gray-500 leading-relaxed">
                  Goods meant for sale or trade. Requires a formal invoice and duty assessment.
                </p>
              </div>
              <div>
                <p className="font-medium text-sm text-gray-900 mb-0.5">CSB V</p>
                <p className="text-xs text-gray-500 leading-relaxed">
                  Courier Shipping Bill V — a simplified export process for low-value goods usually under ₹5,00,000 sent via courier.
                </p>
              </div>
            </div>
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

