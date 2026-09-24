/**
 * The client onboarding document matrix (Bombino accounts dept, 14 Aug 2026:
 * "NEW CLIENT OPEN DOCUMENT COMPULSARY").
 *
 * Five account categories. Four are corporate and differ only in which
 * documents and fields they compel; the fifth is an individual.
 *
 * Both the signup form and the server validator read this file, so the two
 * cannot drift — the form renders exactly the slots the server will insist on.
 */

export type AccountKind = "personal" | "company";

/** The four corporate categories, in the order the source document lists them. */
export const COMPANY_CATEGORIES = [
  "corporate",
  "co_courier",
  "ecommerce",
  "fbb",
] as const;
export type CompanyCategory = (typeof COMPANY_CATEGORIES)[number];

export function isCompanyCategory(v: unknown): v is CompanyCategory {
  return typeof v === "string" && (COMPANY_CATEGORIES as readonly string[]).includes(v);
}

/** Every document an account can be asked for. */
export const DOC_SLOTS = [
  "gst_certificate",
  "iec_certificate",
  "pan_card",
  "electricity_bill",
  "telephone_bill",
  "authorization_letter",
  "aadhaar_card",
] as const;
export type DocSlot = (typeof DOC_SLOTS)[number];

export function isDocSlot(v: unknown): v is DocSlot {
  return typeof v === "string" && (DOC_SLOTS as readonly string[]).includes(v);
}

export interface DocSlotSpec {
  label: string;
  hint: string;
  /**
   * Slots that also carry a number typed by the customer. Only these two do:
   * the GST number is already a first-class field on the form, and the source
   * document asks for the IEC *certificate* without asking for its number.
   */
  numberField?: {
    label: string;
    placeholder: string;
    /** Source of truth for the field — the server re-tests the same pattern. */
    pattern: RegExp;
    maxLength: number;
    /** Upper-cases input on the way in (PAN yes, Aadhaar no). */
    uppercase: boolean;
    error: string;
  };
}

export const DOC_SLOT_SPECS: Record<DocSlot, DocSlotSpec> = {
  gst_certificate: {
    label: "GST Certificate",
    hint: "Registration certificate issued on the GST portal",
  },
  iec_certificate: {
    label: "IEC Certificate",
    hint: "Importer-Exporter Code certificate (DGFT)",
  },
  pan_card: {
    label: "PAN Card",
    hint: "Company PAN if the account is a company",
    numberField: {
      label: "PAN Number",
      placeholder: "ABCDE1234F",
      pattern: /^[A-Z]{5}[0-9]{4}[A-Z]$/,
      maxLength: 10,
      uppercase: true,
      error: "Enter a valid 10-character PAN",
    },
  },
  electricity_bill: {
    label: "Electricity Bill",
    hint: "Any recent bill for the registered address",
  },
  telephone_bill: {
    label: "Telephone Bill",
    hint: "Any recent bill for the registered address",
  },
  authorization_letter: {
    label: "Authorization Letter",
    hint: "Signed contract copy",
  },
  aadhaar_card: {
    label: "Aadhaar Card",
    hint: "Both sides in one file, if scanned separately",
    numberField: {
      label: "Aadhaar Number",
      placeholder: "XXXX XXXX XXXX",
      pattern: /^\d{12}$/,
      maxLength: 12,
      uppercase: false,
      error: "Enter a valid 12-digit Aadhaar number",
    },
  },
};

/** Extra text fields beyond the ones every account gives. */
export const EXTRA_FIELDS = [
  "lut_no",
  "iec_branch_code",
  "bank_account_no",
  "bank_ad_code",
] as const;
export type ExtraField = (typeof EXTRA_FIELDS)[number];

export interface ExtraFieldSpec {
  label: string;
  placeholder: string;
  pattern: RegExp;
  maxLength: number;
  uppercase: boolean;
  error: string;
}

export const EXTRA_FIELD_SPECS: Record<ExtraField, ExtraFieldSpec> = {
  lut_no: {
    label: "LUT Number",
    placeholder: "AD270324000123X",
    pattern: /^[A-Z0-9/-]{6,30}$/,
    maxLength: 30,
    uppercase: true,
    error: "Enter the LUT number as it appears on the acknowledgement",
  },
  iec_branch_code: {
    label: "IEC Branch Code",
    placeholder: "1",
    pattern: /^[0-9]{1,4}$/,
    maxLength: 4,
    uppercase: false,
    error: "Branch code is up to 4 digits",
  },
  bank_account_no: {
    label: "Bank Account Number",
    placeholder: "000123456789",
    pattern: /^[0-9]{9,18}$/,
    maxLength: 18,
    uppercase: false,
    error: "Account number is 9 to 18 digits",
  },
  bank_ad_code: {
    label: "Bank AD Code",
    placeholder: "6390005-0100002",
    pattern: /^[0-9]{7}-?[0-9]{0,7}$/,
    maxLength: 15,
    uppercase: false,
    error: "AD code is 7 digits, optionally followed by the 7-digit branch part",
  },
};

export interface CategorySpec {
  /** What the customer sees in the dropdown. */
  label: string;
  /** One line under the label, so the customer can tell the four apart. */
  description: string;
  /** ITD contract head. Corporate and FBB deliberately share AC005. */
  contractHead: string;
  /** Only ECOMMERCE carries one. */
  groupCode?: string;
  documents: readonly DocSlot[];
  extraFields: readonly ExtraField[];
}

const COMPANY_BASE_DOCS = [
  "gst_certificate",
  "iec_certificate",
  "pan_card",
  "authorization_letter",
] as const;

export const COMPANY_CATEGORY_SPECS: Record<CompanyCategory, CategorySpec> = {
  corporate: {
    label: "Corporate",
    description: "A registered business shipping under its own GST",
    contractHead: "AC005",
    documents: [
      "gst_certificate",
      "iec_certificate",
      "pan_card",
      "electricity_bill",
      "telephone_bill",
      "authorization_letter",
    ],
    extraFields: [],
  },
  co_courier: {
    label: "Co-Courier",
    description: "A courier company handing over consignments to Bombino",
    contractHead: "AC008",
    documents: COMPANY_BASE_DOCS,
    extraFields: [],
  },
  ecommerce: {
    label: "E-commerce",
    description: "An online seller exporting under LUT",
    contractHead: "AC006",
    groupCode: "B1305",
    documents: COMPANY_BASE_DOCS,
    // Export-under-LUT paperwork: the LUT itself plus the banking route the
    // remittance comes back through.
    extraFields: ["lut_no", "iec_branch_code", "bank_account_no", "bank_ad_code"],
  },
  fbb: {
    label: "FBB",
    description: "Fulfilled by Bombino — stock held and shipped by us",
    contractHead: "AC005",
    documents: [
      "gst_certificate",
      "iec_certificate",
      "pan_card",
      "electricity_bill",
      "telephone_bill",
      "authorization_letter",
    ],
    extraFields: [],
  },
};

/**
 * The slots an OCR check can speak to, and the Cashfree document type each
 * maps to. Everything else — a GST certificate, an IEC certificate, a utility
 * bill, an authorization letter — has no OCR equivalent and is never sent.
 *
 * This lives here rather than beside the Cashfree client because both sides
 * need it and they must not disagree: the server refuses to open an account on
 * an identity document that is not `match`, so a form that thought the slot
 * was fine would send the customer into a rejection two screens later.
 */
export const OCR_SLOT_DOCUMENT_TYPES = {
  pan_card: "PAN",
  aadhaar_card: "AADHAAR",
} as const satisfies Partial<Record<DocSlot, string>>;

export type OcrCheckedSlot = keyof typeof OCR_SLOT_DOCUMENT_TYPES;

/** True when Cashfree Smart OCR is the thing that reads this slot. */
export function isOcrCheckedSlot(slot: string): slot is OcrCheckedSlot {
  return slot in OCR_SLOT_DOCUMENT_TYPES;
}

/**
 * Every slot whose document is checked against a number we already proved —
 * which is a wider set than the one Cashfree can read.
 *
 * Smart OCR takes eight document types and a GST certificate is none of them,
 * so that slot is read by server/gstCertificate.ts instead: the PDF's own text
 * layer, falling back to a vision call for a photograph. The verdicts and the
 * account-creation gate are identical either way, which is why these three
 * belong in one list even though two different readers produce them.
 */
export const VERIFIED_DOC_SLOTS = ["pan_card", "aadhaar_card", "gst_certificate"] as const;

export type VerifiedDocSlot = (typeof VERIFIED_DOC_SLOTS)[number];

/** True when this slot must come back verified before an account can open. */
export function isVerifiedDocSlot(slot: string): slot is VerifiedDocSlot {
  return (VERIFIED_DOC_SLOTS as readonly string[]).includes(slot);
}

/**
 * An individual. The source document also names a signed contract, which is
 * collected on paper today and has no upload slot here yet.
 */
export const PERSONAL_DOCUMENTS = ["aadhaar_card", "pan_card"] as const satisfies readonly DocSlot[];

/** The documents an account of this shape must produce before it is created. */
export function requiredDocuments(
  accountType: AccountKind,
  category?: CompanyCategory | null
): readonly DocSlot[] {
  if (accountType === "personal") return PERSONAL_DOCUMENTS;
  if (!category) return [];
  return COMPANY_CATEGORY_SPECS[category].documents;
}

export function requiredExtraFields(category?: CompanyCategory | null): readonly ExtraField[] {
  if (!category) return [];
  return COMPANY_CATEGORY_SPECS[category].extraFields;
}

/** Slots still outstanding, in the order the form shows them. */
export function missingDocuments(
  accountType: AccountKind,
  category: CompanyCategory | null | undefined,
  uploaded: Iterable<string>
): DocSlot[] {
  const have = new Set(uploaded);
  return requiredDocuments(accountType, category).filter((slot) => !have.has(slot));
}

/**
 * The identity numbers that must be recorded *before* any document is
 * uploaded.
 *
 * Derived from the document matrix rather than listed separately, so the two
 * cannot drift: every slot whose document gets checked is a slot whose number
 * we take first. In practice that is Aadhaar and PAN for a personal account,
 * and PAN plus GSTIN for all four corporate categories.
 *
 * "Recorded", not "verified against the issuing authority" — only the GSTIN
 * still is. Aadhaar and PAN are typed and self-asserted, and what stands
 * behind them is the OCR match at the document step.
 *
 * The order matters either way: the number is taken first, so the document
 * upload has to agree with a value the customer can no longer change. For the
 * two self-asserted kinds that ordering is the whole of the check. See
 * server/cashfreeIdentity.ts.
 */
export function requiredIdentityChecks(
  accountType: AccountKind,
  category?: CompanyCategory | null
): VerifiedDocSlot[] {
  return requiredDocuments(accountType, category).filter(isVerifiedDocSlot);
}

/** What the customer is asked for at the identity step, per check. */
export const IDENTITY_CHECK_LABELS: Record<VerifiedDocSlot, string> = {
  aadhaar_card: "Aadhaar",
  pan_card: "PAN",
  gst_certificate: "GST",
};
/**
 * Cashfree's first-layer verdicts that count as a pass: it read the document
 * and it agreed (`match`), or the check is switched off on test credentials
 * (`bypassed`). `ocr_status` only ever holds Cashfree's word.
 */
export const ACCEPTED_OCR_STATUSES: readonly string[] = ["match", "bypassed"];

export function isAcceptedOcrStatus(status: string | null | undefined): boolean {
  return typeof status === "string" && ACCEPTED_OCR_STATUSES.includes(status);
}

/**
 * One uploaded slot, reduced to the facts a verdict depends on: Cashfree's
 * first-layer result, and whether a Bombino reviewer has verified it by hand
 * (`ocr_verified_at`, migrations/add_manual_document_verification.sql).
 */
export interface DocumentVerdict {
  doc_slot: string;
  ocr_status: string | null;
  ocr_verified_at?: string | null;
}

/**
 * A reviewer opened the document and vouched for it. With account review on
 * this is what every document needs before an account opens; Cashfree's
 * verdict is advice to the reviewer, not an approval.
 */
export function isStaffVerified(doc: { ocr_verified_at?: string | null }): boolean {
  return Boolean(doc.ocr_verified_at);
}

/** Verified by a reviewer, or (accounts opened before review) passed by Cashfree. */
export function isDocumentVerified(doc: DocumentVerdict): boolean {
  return isStaffVerified(doc) || isAcceptedOcrStatus(doc.ocr_status);
}

/**
 * Is this account's document set complete *and* verified?
 *
 * The single definition of "verified", shared by everything that has an opinion
 * about it: the signup gate (assertDocumentsStaged), the customer's warning
 * banner, the docket guard, and the ops queue. They cannot be allowed to
 * disagree — a banner that clears while the docket guard still holds is a
 * support ticket, and a signup that passes while the banner stays up is worse.
 *
 * Two ways to fall short, kept apart because they read differently to the
 * customer:
 *
 *   missing     nothing was uploaded for that slot
 *   unverified  something was, and the reader did not confirm it (a blurred
 *               scan, or Cashfree unreachable). Note that a document which
 *               actively *contradicted* the typed number never reaches storage
 *               at all — that upload is refused. See server/cashfreeOcr.ts.
 *
 * Keyed on isVerifiedDocSlot, NOT isOcrCheckedSlot, and the difference is the
 * GST certificate: Cashfree Smart OCR has no document type for one, so it is
 * absent from OCR_SLOT_DOCUMENT_TYPES and would be treated as verified by its
 * mere presence. It is not — server/gstCertificate.ts reads it locally and
 * writes a real verdict. Keying on the Cashfree type would exempt exactly the
 * one document a corporate account rests on. Slots nothing reads at all
 * (bills, IEC and authorization letters) are verified by presence.
 *
 * A document a Bombino reviewer verified by hand counts as verified whatever
 * Cashfree said: with account review on, that is how every account opens.
 *
 * `bypassed` counts as verified, exactly as assertDocumentsStaged treats it:
 * OCR_BYPASS=1 means a flag said not to ask, and those files are stored
 * unchecked on purpose. Without this a staging environment running that flag
 * could not open an account at all, and would hold every order it had already
 * taken at `generate_docket` forever.
 */
export function verificationState(
  accountType: AccountKind,
  category: CompanyCategory | null | undefined,
  documents: readonly DocumentVerdict[]
): { verified: boolean; missing: DocSlot[]; unverified: DocSlot[] } {
  const required = requiredDocuments(accountType, category);
  const bySlot = new Map(documents.map((row) => [row.doc_slot, row]));

  const missing: DocSlot[] = [];
  const unverified: DocSlot[] = [];

  for (const slot of required) {
    const row = bySlot.get(slot);
    if (!row) {
      missing.push(slot);
    } else if (isVerifiedDocSlot(slot) && !isDocumentVerified(row)) {
      unverified.push(slot);
    }
  }

  return { verified: missing.length === 0 && unverified.length === 0, missing, unverified };
}
