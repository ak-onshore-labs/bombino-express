/**
 * The shadow profile — what a guest already is, before they are an account.
 *
 * A guest who books gives us more than the booking: `GuestVerification` proves
 * a phone number by OTP, and `AccountDocuments` stages an identity document
 * against that same number. That is most of a customer record. What is missing
 * is a name, an email and (sometimes) the document itself.
 *
 * This file is the shared vocabulary for saying which of those four things are
 * settled and which are outstanding, so the banner, the dashboard and the
 * post-booking nudge cannot disagree about it.
 *
 * It is pure and holds nothing: the profile itself lives on the server, keyed
 * on the session's `guest_ref`, and reaches these functions through
 * `useGuestProfile`. Nothing here reads or writes storage — an earlier version
 * kept the profile in localStorage, which made it a per-browser copy that no
 * other device and no server correction could ever see.
 *
 * Deliberately NOT modelled on `VerificationState` (hooks/useVerificationState).
 * That describes a signed-in account's document matrix, which a guest does not
 * have — a guest has one identity document and a number, and asking them to
 * reason about six corporate slots at this point would be asking them to open
 * an account, which is exactly what they declined to do.
 */

import {
  Phone,
  User,
  Mail,
  ShieldCheck,
  UserSquare,
  BadgeCheck,
  Building2,
  FileText,
  MapPin,
  Landmark,
  Warehouse,
  type LucideIcon,
} from 'lucide-react';
import {
  COMPANY_CATEGORY_SPECS,
  EXTRA_FIELD_SPECS,
  requiredExtraFields,
  type CompanyCategory,
  type ExtraField,
} from '@shared/accountSpec';
import { INDIA_HUBS } from '@shared/hubs';

/**
 * Every row the profile can show. Which of them apply is decided by the
 * account type and, for a company, by its category — see `profileFieldKeys`.
 * The company set is signup's own list (client/src/pages/Signup.tsx §details),
 * because a guest opening a company account owes exactly what signup asks.
 */
export type ShadowProfileFieldKey =
  | 'account_type'
  | 'phone'
  | 'full_name'
  | 'email'
  | 'company_category'
  | 'company_name'
  | 'gstin'
  | 'contact_person'
  | 'address_line_1'
  | 'pincode'
  | 'city'
  | 'state'
  | 'hub_id'
  | ExtraField
  | 'documents'
  | 'account';

export type GuestAccountType = 'personal' | 'company';

export const ACCOUNT_TYPE_LABEL: Record<GuestAccountType, string> = {
  personal: 'Personal',
  company: 'Company',
};

/**
 * Four states, not two.
 *
 * `verified` is reserved for what something outside the customer confirmed —
 * an OTP the server checked, a document OCR read and agreed with. A name and
 * an email are typed by the person themselves and nobody checked them, so they
 * are `provided`: on file, nothing more to do, and not a claim we have proved
 * anything. Labelling a self-declared name "Verified" is the kind of thing
 * that reads fine on a design and badly on a customs docket.
 *
 * `in_review` is a document OCR could not confirm — unreadable, unavailable,
 * skipped or bypassed. The customer has no further action, so showing it as
 * "Pending" would ask them to do something twice, and showing it as verified
 * would promise an outcome that has not landed yet.
 */
export type ShadowFieldStatus = 'verified' | 'provided' | 'in_review' | 'pending';

/**
 * One of the guest's bookings, exactly as `GET /api/guest/profile` returns it.
 *
 * Field names match the server's response one-for-one so there is no mapping
 * layer to drift. See server/guestProfileDb.ts §GuestOrderSummary.
 */
export interface GuestOrderSummary {
  order_no: string;
  order_id: string;
  status: string;
  /** shared/orderContract.ts §PaymentStatus. */
  payment_status: string;
  payment_method: string;
  awb_no: string | null;
  created_at: string;
  /** "Springfield, IL, United States" — from the consignee on the order. */
  destination: string | null;
  guest_name: string | null;
  guest_email: string | null;
}

/** The server's answer for the guest this session is. */
export interface GuestProfile {
  /** 10-digit number, no country code — the one proved by OTP. */
  phone: string;
  full_name: string | null;
  email: string | null;
  /** Stated intent, not an account. Null until they choose. */
  account_type: GuestAccountType | null;
  /**
   * The company set, mirroring what signup asks for that shape. All null on a
   * personal profile, and null on a company one until each is answered.
   */
  company_category: CompanyCategory | null;
  company_name: string | null;
  gstin: string | null;
  /** The GST registry's own spelling of the name behind that number. */
  gstin_verified_name: string | null;
  contact_person: string | null;
  address_line_1: string | null;
  pincode: string | null;
  city: string | null;
  state: string | null;
  hub_id: string | null;
  /** Category extras, keyed by shared/accountSpec.ts §ExtraField. */
  extras: Partial<Record<ExtraField, string>>;
  kyc: { status: 'verified' | 'in_review'; summary: string } | null;
  /**
   * The document set the account will owe, and how far through it they are.
   * Empty until an account type is chosen, because the matrix depends on it.
   */
  documents: {
    required: string[];
    provided: string[];
    missing: string[];
    unverified: string[];
  };
  orders: GuestOrderSummary[];
}

/**
 * How a row is answered.
 *
 *  `text`    typed, saved on its own
 *  `email`   typed, email keyboard
 *  `choice`  one of a fixed list, saved on tap
 *  `pincode` typed, and fills city and state from the lookup
 *  `gstin`   typed, then checked against the GST registry before it is stored
 *  `readonly` shown, never edited here (the phone)
 *  `route`   handed to another screen (the identity document)
 */
export type ShadowFieldKind =
  | 'text'
  | 'email'
  | 'choice'
  | 'pincode'
  | 'gstin'
  | 'readonly'
  | 'route';

export interface ShadowFieldChoice {
  value: string;
  label: string;
  description?: string;
}

export interface ShadowProfileFieldSpec {
  key: ShadowProfileFieldKey;
  label: string;
  /** Shown under the value once the field is settled. */
  hint: string;
  /** Shown instead when it is still outstanding — says why we want it. */
  pendingHint: string;
  icon: LucideIcon;
  kind: ShadowFieldKind;
  placeholder?: string;
  choices?: readonly ShadowFieldChoice[];
  /** Upper-cased on the way in, as signup does for these. */
  uppercase?: boolean;
  maxLength?: number;
}

/**
 * Order matters: this is the order the dashboard, the tracker and the banner
 * all read in, and it runs from what we already have to what we still want.
 */
/**
 * Every row's copy and behaviour, in one place.
 *
 * The company entries mirror signup's own fields one for one, same labels and
 * same rules, because a guest filling these in is filling in the account form,
 * one question per visit instead of all of it at once.
 */
export const SHADOW_FIELD_SPECS: Record<ShadowProfileFieldKey, ShadowProfileFieldSpec> = {
  account_type: {
    // First, because it decides everything after it: which rows appear at all,
    // which documents are owed, whose name the invoice carries.
    key: 'account_type',
    label: 'Account type',
    hint: 'What we open when you create an account',
    pendingHint: 'Personal or company. It decides what we ask for next.',
    icon: UserSquare,
    kind: 'choice',
    choices: [
      {
        value: 'personal',
        label: 'Personal',
        description: 'Sending your own parcels. Aadhaar and PAN.',
      },
      {
        value: 'company',
        label: 'Company',
        description: 'Shipping under a GSTIN. Invoices in the company name.',
      },
    ],
  },
  phone: {
    key: 'phone',
    label: 'Mobile number',
    hint: 'Verified by OTP',
    pendingHint: 'Verify a number to start tracking your orders',
    icon: Phone,
    kind: 'readonly',
  },
  full_name: {
    key: 'full_name',
    label: 'Full name',
    hint: 'As it appears on your identity document',
    pendingHint: 'Needed on the shipping docket and the invoice',
    icon: User,
    kind: 'text',
    placeholder: 'e.g. Aditya Kamarouthu',
    maxLength: 80,
  },
  email: {
    key: 'email',
    label: 'Email address',
    hint: 'Where booking and delivery updates go',
    pendingHint: 'Where we send your receipt and delivery updates',
    icon: Mail,
    kind: 'email',
    placeholder: 'you@example.com',
    maxLength: 254,
  },
  company_category: {
    key: 'company_category',
    label: 'Account category',
    hint: 'Decides which documents the account owes',
    pendingHint: 'Which kind of business this account is for',
    icon: Building2,
    kind: 'choice',
    choices: (Object.keys(COMPANY_CATEGORY_SPECS) as CompanyCategory[]).map((value) => ({
      value,
      label: COMPANY_CATEGORY_SPECS[value].label,
      description: COMPANY_CATEGORY_SPECS[value].description,
    })),
  },
  company_name: {
    key: 'company_name',
    label: 'Company name',
    hint: 'The name the GST number is registered to',
    pendingHint: 'As registered. The GST check compares against it.',
    icon: Building2,
    kind: 'text',
    placeholder: 'Registered company name',
    maxLength: 120,
  },
  gstin: {
    key: 'gstin',
    label: 'GST number',
    hint: 'Verified with the GST registry',
    pendingHint: 'Checked against the registry when you save it',
    icon: FileText,
    kind: 'gstin',
    placeholder: '22AAAAA0000A1Z5',
    uppercase: true,
    maxLength: 15,
  },
  contact_person: {
    key: 'contact_person',
    label: 'Contact person',
    hint: 'Who we speak to about a shipment',
    pendingHint: 'Who we speak to about a shipment',
    icon: User,
    kind: 'text',
    placeholder: 'Who we speak to',
    maxLength: 80,
  },
  address_line_1: {
    key: 'address_line_1',
    label: 'Address',
    hint: 'The registered address',
    pendingHint: 'Street address of the registered office',
    icon: MapPin,
    kind: 'text',
    placeholder: 'Street address',
    maxLength: 200,
  },
  pincode: {
    key: 'pincode',
    label: 'Pincode',
    hint: 'Fills the city and state',
    pendingHint: 'Six digits. We fill the city and state from it.',
    icon: MapPin,
    kind: 'pincode',
    placeholder: '6-digit pincode',
    maxLength: 6,
  },
  city: {
    key: 'city',
    label: 'City',
    hint: 'From your pincode',
    pendingHint: 'Filled from your pincode, editable',
    icon: MapPin,
    kind: 'text',
    placeholder: 'City',
    maxLength: 80,
  },
  state: {
    key: 'state',
    label: 'State',
    hint: 'From your pincode',
    pendingHint: 'Filled from your pincode, editable',
    icon: MapPin,
    kind: 'text',
    placeholder: 'State',
    maxLength: 80,
  },
  hub_id: {
    key: 'hub_id',
    label: 'Hub',
    hint: 'Where your parcels are handled',
    pendingHint: 'The Bombino hub your parcels go through',
    icon: Warehouse,
    kind: 'choice',
    choices: INDIA_HUBS.map((hub) => ({ value: String(hub.id), label: hub.name })),
  },
  // The four category extras, built from the same specs signup validates
  // against, so a value accepted here cannot be refused there.
  ...(Object.fromEntries(
    (Object.keys(EXTRA_FIELD_SPECS) as ExtraField[]).map((field) => {
      const spec = EXTRA_FIELD_SPECS[field];
      return [
        field,
        {
          key: field,
          label: spec.label,
          hint: 'On file',
          pendingHint: spec.error,
          icon: Landmark,
          kind: 'text' as const,
          placeholder: spec.placeholder,
          uppercase: spec.uppercase,
          maxLength: spec.maxLength,
        },
      ];
    })
  ) as Record<ExtraField, ShadowProfileFieldSpec>),
  documents: {
    key: 'documents',
    label: 'Documents',
    hint: 'Everything the account needs is on file',
    pendingHint: 'Customs needs one to ship; the account needs the full set',
    icon: ShieldCheck,
    kind: 'route',
  },
  /**
   * The account itself.
   *
   * Signup's last two steps — the document matrix and the contract — happen
   * outside this screen, so a profile with every field answered was reading
   * 100% while no account existed. This row is what stops the tracker
   * claiming a finish line it cannot see.
   */
  account: {
    key: 'account',
    label: 'Account',
    hint: 'Open, with your orders attached',
    pendingHint: 'Sign the contract to open it. Your bookings work meanwhile.',
    icon: BadgeCheck,
    kind: 'route',
  },
};

/**
 * Which rows this particular guest is asked for, in order.
 *
 * A personal account owes what signup's personal step asks: a name, an email
 * and the number. A company owes its whole form, and the last stretch of that
 * depends on the category. `requiredExtraFields` is the same function signup
 * uses, so the two lists cannot diverge.
 *
 * Before the type is chosen there is exactly one question worth asking, and
 * this returns only that: nothing else can be answered sensibly yet.
 */
export function profileFieldKeys(profile: GuestProfile): ShadowProfileFieldKey[] {
  if (!profile.account_type) return ['account_type', 'phone'];

  if (profile.account_type === 'personal') {
    return ['account_type', 'phone', 'full_name', 'email', 'documents', 'account'];
  }

  return [
    'account_type',
    'phone',
    'company_category',
    'company_name',
    'gstin',
    'contact_person',
    'email',
    'address_line_1',
    'pincode',
    'city',
    'state',
    'hub_id',
    ...requiredExtraFields(profile.company_category as CompanyCategory | undefined),
    'documents',
    'account',
  ];
}

export interface ShadowProfileFieldState {
  spec: ShadowProfileFieldSpec;
  status: ShadowFieldStatus;
  /** The value to display, already formatted. Null while pending. */
  value: string | null;
}

/** Presentation for each status. One place, so no two surfaces drift. */
export const SHADOW_STATUS_META: Record<
  ShadowFieldStatus,
  { label: string; badge: string; dot: string }
> = {
  verified: {
    label: 'Verified',
    badge: 'bg-green-50 text-green-700 border-green-200',
    dot: 'bg-green-500',
  },
  provided: {
    label: 'Added',
    badge: 'bg-slate-100 text-slate-700 border-slate-200',
    dot: 'bg-slate-400',
  },
  in_review: {
    label: 'In review',
    badge: 'bg-blue-50 text-blue-700 border-blue-200',
    dot: 'bg-blue-500',
  },
  pending: {
    label: 'Pending',
    badge: 'bg-amber-50 text-amber-700 border-amber-200',
    dot: 'bg-amber-500',
  },
};

/** How a booking's payment reads on the profile screen. */
export const ORDER_PAYMENT_META: Record<string, { label: string; badge: string }> = {
  paid: { label: 'Paid', badge: 'bg-green-50 text-green-700 border-green-200' },
  pending: { label: 'Payment due', badge: 'bg-amber-50 text-amber-700 border-amber-200' },
  partially_paid: {
    label: 'Part paid',
    badge: 'bg-amber-50 text-amber-700 border-amber-200',
  },
  refund_due: { label: 'Refund due', badge: 'bg-blue-50 text-blue-700 border-blue-200' },
  failed: { label: 'Payment failed', badge: 'bg-red-50 text-red-700 border-red-200' },
};

function present(value: string | null | undefined): string | null {
  const trimmed = (value ?? '').trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** `+91 98765 43210` — the format the rest of the customer app already uses. */
export function formatGuestPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '').slice(-10);
  if (digits.length !== 10) return phone;
  return `+91 ${digits.slice(0, 5)} ${digits.slice(5)}`;
}

/** `4 Sep 2026`. Short, and unambiguous about the month. */
export function formatOrderDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

/**
 * The raw value behind each row, before it is dressed for display.
 *
 * The extras live in one jsonb object rather than a column each, so they are
 * looked up by key here instead of appearing in the switch.
 */
function rawValue(profile: GuestProfile, key: ShadowProfileFieldKey): string | null {
  switch (key) {
    case 'account_type':
      return profile.account_type;
    case 'phone':
      return profile.phone;
    case 'full_name':
      return profile.full_name;
    case 'email':
      return profile.email;
    case 'company_category':
      return profile.company_category;
    case 'company_name':
      return profile.company_name;
    case 'gstin':
      return profile.gstin;
    case 'contact_person':
      return profile.contact_person;
    case 'address_line_1':
      return profile.address_line_1;
    case 'pincode':
      return profile.pincode;
    case 'city':
      return profile.city;
    case 'state':
      return profile.state;
    case 'hub_id':
      return profile.hub_id;
    case 'documents': {
      const { required, provided } = profile.documents;
      if (required.length === 0) return null;
      // Counted, not named: which slots they are is signup's business, and
      // "1 of 2" is the thing somebody wants to know at a glance.
      return provided.length === 0
        ? null
        : `${provided.length} of ${required.length} uploaded`;
    }
    // Always outstanding here. A guest with an account is not a guest, and
    // this endpoint refuses a signed-in session outright.
    case 'account':
      return null;
    default:
      return profile.extras?.[key] ?? null;
  }
}

/**
 * How settled each row is.
 *
 * `verified` is reserved for what something outside the customer confirmed:
 * the OTP on the number, and the GST registry on the GSTIN. Everything else a
 * customer types is `provided`, however carefully we validated the shape of
 * it, because validation is not confirmation.
 */
function statusFor(
  profile: GuestProfile,
  key: ShadowProfileFieldKey,
  value: string | null
): ShadowFieldStatus {
  if (key === 'documents') {
    const { required, provided, unverified } = profile.documents;
    if (required.length === 0 || provided.length === 0) return 'pending';
    if (provided.length < required.length) return 'pending';
    // Every slot filled, but OCR could not confirm one of them. Nothing left
    // for the customer to do, and not a claim that anyone checked it.
    return unverified.length > 0 ? 'in_review' : 'verified';
  }
  if (key === 'account') return 'pending';
  if (!value) return 'pending';
  if (key === 'phone') return 'verified';
  if (key === 'gstin') return 'verified';
  return 'provided';
}

/** What the row shows: a label for a choice, a formatted number, or the value. */
function displayValue(
  profile: GuestProfile,
  spec: ShadowProfileFieldSpec,
  value: string | null
): string | null {
  if (!value) return null;
  if (spec.key === 'phone') return formatGuestPhone(value);
  if (spec.kind === 'choice') {
    return spec.choices?.find((choice) => choice.value === value)?.label ?? value;
  }
  return value;
}

export function deriveShadowProfileFields(
  profile: GuestProfile,
  keys?: readonly ShadowProfileFieldKey[]
): ShadowProfileFieldState[] {
  return (keys ?? profileFieldKeys(profile)).map((key): ShadowProfileFieldState => {
    const spec = SHADOW_FIELD_SPECS[key];
    const raw = present(rawValue(profile, key));
    return {
      spec,
      status: statusFor(profile, key, raw),
      value: displayValue(profile, spec, raw),
    };
  });
}

export interface ShadowProfileProgress {
  fields: ShadowProfileFieldState[];
  /** Outstanding only — what the banner counts and names. */
  pending: ShadowProfileFieldState[];
  /**
   * Settled, whichever way — verified, provided, or in review. A document in
   * review counts: the customer has nothing left to do for it, and a bar that
   * refuses to move while we think reads as a bar that is broken.
   */
  completed: number;
  total: number;
  /** 0–100, rounded. */
  percent: number;
  complete: boolean;
}

export function shadowProfileProgress(profile: GuestProfile): ShadowProfileProgress {
  const fields = deriveShadowProfileFields(profile);
  const pending = fields.filter((f) => f.status === 'pending');
  const completed = fields.length - pending.length;

  return {
    fields,
    pending,
    completed,
    total: fields.length,
    percent: fields.length === 0 ? 0 : Math.round((completed / fields.length) * 100),
    complete: pending.length === 0,
  };
}

/** "full name and email" — an Oxford-less list for one line of banner. */
export function listPendingLabels(pending: ShadowProfileFieldState[]): string {
  const labels = pending.map((f) => f.spec.label.toLowerCase());
  if (labels.length === 0) return '';
  if (labels.length === 1) return labels[0];
  return `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`;
}
