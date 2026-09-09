// ITD Courier Service API client
// Base URLs:
//   admin: https://admin.bombinoexp.com
//   app:   https://app.bombinoexp.com (Rate API only)

const ADMIN_BASE = "https://admin.bombinoexp.com";
const APP_BASE = "https://app.bombinoexp.com";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ITDUserInfo {
  id: string;
  customerId: string;
  code: string;
  email: string;
  fullName: string;
  username: string;
  role: string;
  /**
   * Bombino-side, not an ITD field — ITD's auth response carries nothing like
   * it. Set on the OTP signup/login paths (A2) so the client can branch on
   * account type without a second request. Absent for legacy ITD password
   * logins, which every consumer must treat as `personal`.
   */
  account_type?: "personal" | "company";
}

export interface ITDAuthResponse {
  success: boolean;
  data: {
    id: string;
    customer_id: string;
    code: string;
    email: string;
    user_fullname: string;
    role: string;
    token: string;
    username: string;
    success: boolean;
    errors: string[];
  };
  errors: string[];
}

export interface DocketEvent {
  id: string;
  docket_id: string;
  event_at: string;
  event_type: string;
  event_description: string;
  event_location: string;
  add_city: string;
  add_state_or_province_code: string;
  add_postal_code: string;
  add_country_code: string;
  add_country_name: string;
  created_at: string;
  updated_at: string;
  event_state: string;
  event_remark: string;
}

export interface ITDTrackingResult {
  errors: boolean;
  tracking_no: string;
  chargeable_weight: string;
  forwarding_no: string;
  pcs: string;
  docket_info: [string, string][];
  docket_events: DocketEvent[];
  parcel_docket_events: Record<string, unknown>;
  all_parcel_no: Record<string, unknown>;
}

export interface DocketItem {
  actual_weight: string;
  length: string;
  width: string;
  height: string;
  number_of_boxes: string;
}

export interface FreeFormLineItem {
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

export interface CreateShipmentPayload {
  tracking_no?: string;
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
  remark?: string;
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
  shipper_address_line_2?: string;
  shipper_address_line_3?: string;
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
  consignee_address_line_2?: string;
  consignee_address_line_3?: string;
  consignee_city: string;
  consignee_state: string;
  consignee_country: string;
  consignee_zip_code: string;
  docket_items: DocketItem[];
  free_form_line_items?: FreeFormLineItem[];
  kyc_details?: KYCDetail[];
}

export interface KYCDetail {
  document_type: string;
  document_no: string;
  document_sub_type: string;
  document_name: string;
  file_path: string;
}

export interface CreateShipmentResponse {
  success: boolean;
  errors: string[];
  data: {
    docket_id: number;
    awb_no: string;
    forwording_no: string;
    entry_number: string;
    remote_area_charges: string;
  };
  labels: { label: string; filename?: string; file_type?: string }[];
}

export interface AddCustomerPayload {
  name: string;
  email?: string;
  contact_no: string;
  gst_number: string;
  address?: string;
  pincode?: string;
  city?: string;
  state?: string;
  contact_person?: string;
  hub_id: number;
}

export interface AddCustomerResponse {
  success: boolean;
  errors: string[];
  data: Record<string, unknown>;
}

export interface RateParams {
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

// ─── Client ───────────────────────────────────────────────────────────────────

class ITDClient {
  private token: string | null = null;
  private tokenExpiry: number = 0;

  // Fetch and cache Bearer token using company credentials. Re-authenticates when expired.
  async getToken(): Promise<string> {
    if (this.token && Date.now() < this.tokenExpiry) {
      return this.token;
    }

    const res = await fetch(`${ADMIN_BASE}/docket_api/get_token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        company_id: Number(process.env.ITD_COMPANY_ID),
        email: process.env.ITD_EMAIL,
        password: process.env.ITD_PASSWORD,
      }),
    });

    if (!res.ok) {
      throw new Error(`ITD auth failed: ${res.status} ${res.statusText}`);
    }

    const json = (await res.json()) as ITDAuthResponse;
    if (!json.success || !json.data?.token) {
      throw new Error(`ITD auth error: ${JSON.stringify(json.errors)}`);
    }

    this.token = json.data.token;
    // Cache for 4 hours (ITD tokens expire after ~4h)
    this.tokenExpiry = Date.now() + 4 * 60 * 60 * 1000;
    return this.token;
  }

  // Authenticate a user with their own credentials (not the company token).
  // Returns the user's token + info — caller must store in session.
  async loginUser(
    email: string,
    password: string
  ): Promise<{ token: string; user: ITDUserInfo }> {
    const res = await fetch(`${ADMIN_BASE}/docket_api/get_token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        company_id: Number(process.env.ITD_COMPANY_ID),
        email,
        password,
      }),
    });

    if (!res.ok) {
      throw new Error(`ITD auth failed: ${res.status} ${res.statusText}`);
    }

    const json = (await res.json()) as ITDAuthResponse;
    if (!json.success || !json.data?.token) {
      const errMsg = json.errors?.join(", ") || "Invalid credentials";
      throw new Error(errMsg);
    }

    const user: ITDUserInfo = {
      id: json.data.id,
      customerId: json.data.customer_id,
      code: json.data.code,
      email: json.data.email,
      fullName: json.data.user_fullname,
      username: json.data.username,
      role: json.data.role,
    };

    return { token: json.data.token, user };
  }

  // Invalidate cached company token (called on 401 responses)
  private invalidateToken(): void {
    this.token = null;
    this.tokenExpiry = 0;
  }

  // GET /api/tracking_api/get_tracking_data
  // Uses the provided user token if given, otherwise falls back to the shared company token.
  async trackShipment(
    trackingNo: string,
    token?: string,
    customerCode?: string
  ): Promise<ITDTrackingResult[]> {
    const authToken = token ?? (await this.getToken());
    const params = new URLSearchParams({
      api_company_id: process.env.ITD_API_COMPANY_ID ?? "2",
      customer_code: customerCode ?? process.env.ITD_CUSTOMER_CODE ?? "",
      tracking_no: trackingNo,
    });

    const res = await fetch(
      `${ADMIN_BASE}/api/tracking_api/get_tracking_data?${params}`,
      {
        headers: { Authorization: `Bearer ${authToken}` },
      }
    );

    if (res.status === 401) {
      if (!token) this.invalidateToken();
      throw new Error("ITD token expired — please retry");
    }
    if (!res.ok) {
      throw new Error(`ITD tracking error: ${res.status} ${res.statusText}`);
    }

    return (await res.json()) as ITDTrackingResult[];
  }

  // POST /docket_api/create_docket — always requires a user session token
  async createShipment(
    data: CreateShipmentPayload,
    token: string
  ): Promise<CreateShipmentResponse> {
    const res = await fetch(`${ADMIN_BASE}/docket_api/create_docket`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ ...data, tracking_no: data.tracking_no ?? "" }),
    });

    if (res.status === 401) {
      const errorBody = await res.text().catch(() => "");
      console.error(`[ITD createShipment] 401 Unauthorized`, errorBody);
      throw new Error("Session expired — please log in again");
    }
    if (!res.ok) {
      const errorBody = await res.text().catch(() => "");
      console.error(`[ITD createShipment] ${res.status} ${res.statusText}`, errorBody);
      throw new Error(
        `ITD create shipment error: ${res.status} ${res.statusText} — ${errorBody}`
      );
    }

    return (await res.json()) as CreateShipmentResponse;
  }

  // POST /api/customer_api/add_customer — registers a corporate customer with
  // ITD on company signup. Uses the shared company token, not a user token.
  async addCustomer(payload: AddCustomerPayload): Promise<AddCustomerResponse> {
    const token = await this.getToken();
    const companyId = process.env.ITD_API_COMPANY_ID ?? "1";

    const form = new URLSearchParams({
      name: payload.name,
      customer_country: "IN",
      location_code: "IN",
      customer_category: "Company",
      email: payload.email ?? "",
      contact_no: payload.contact_no,
      contact_no2: "",
      address: payload.address ?? "",
      pincode: payload.pincode ?? "",
      city: payload.city ?? "",
      state: payload.state ?? "",
      contact_person: payload.contact_person ?? payload.name,
      hub_id: String(payload.hub_id),
      company_id: companyId,
      gst_number: payload.gst_number,
      customer_setting: JSON.stringify({ show_kyc_after_login: 1, is_fsc_apply: 1 }),
    });

    const res = await fetch(`${ADMIN_BASE}/api/customer_api/add_customer`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Bearer ${token}`,
      },
      body: form,
    });

    if (!res.ok) {
      const errorBody = await res.text().catch(() => "");
      throw new Error(`ITD add_customer error: ${res.status} ${res.statusText} — ${errorBody}`);
    }

    return (await res.json()) as AddCustomerResponse;
  }

  // POST /docket_api/customer_rate_cals (multipart/form-data, different domain)
  async getRates(
    params: RateParams,
    userEmail?: string,
    customerCode?: string,
    passwordPlaintext?: string
  ): Promise<unknown> {
    const username = Buffer.from(
      userEmail ?? process.env.ITD_EMAIL ?? ""
    ).toString("base64");
    const password = Buffer.from(
      passwordPlaintext ?? process.env.ITD_PASSWORD ?? ""
    ).toString("base64");
    const apiCompanyId = process.env.ITD_API_COMPANY_ID ?? "2";

    const form = new FormData();
    form.append("product_code", params.product_code);
    form.append("destination_code", params.destination_code);
    form.append("booking_date", params.booking_date);
    form.append("origin_code", params.origin_code);
    form.append("pcs", params.pcs);
    form.append("actual_weight", params.actual_weight);
    form.append("customer_code", customerCode ?? process.env.ITD_CUSTOMER_CODE ?? "");
    form.append("username", username);
    form.append("password", password);
    if (params.ori_city) form.append("ori_city", params.ori_city);
    if (params.ori_pincode) form.append("ori_pincode", params.ori_pincode);
    if (params.dest_city) form.append("dest_city", params.dest_city);
    if (params.dest_pincode) form.append("dest_pincode", params.dest_pincode);

    const url = `${APP_BASE}/docket_api/customer_rate_cals?api_company_id=${apiCompanyId}`;

    const res = await fetch(url, {
      method: "POST",
      body: form,
    });

    if (!res.ok) {
      throw new Error(`ITD rate error: ${res.status} ${res.statusText}`);
    }

    return res.json();
  }
}

/**
 * Is this failure ITD telling us the token is dead?
 *
 * It does not answer 401 for an expired customer token on create_docket. It
 * answers **500** with `{"success":false,"errors":"AUTH TOKEN EXPIRED. PLEASE
 * GENERATE NEW AUTH TOKEN","Response Code":500}`, which reaches callers as an
 * ordinary thrown Error and is indistinguishable from ITD being broken unless
 * something reads the body. Callers that hold a mintable credential can re-mint
 * and retry; everything else can at least say what actually happened.
 *
 * The 401 wording is matched too, for the paths where ITD does use it.
 */
export function isItdAuthExpired(message: string): boolean {
  return (
    /auth\s+token\s+expired/i.test(message) ||
    /generate\s+new\s+auth\s+token/i.test(message) ||
    /session expired/i.test(message)
  );
}

export const itdClient = new ITDClient();
