import {
  findOrCreateAddress,
  insertShipmentAndReturnId,
  insertShipmentCreatedAuditLog,
  insertShipmentCreatedNotification,
} from "./appDb.js";
import { notifyDispatched } from "./notify.js";
import type { CreateShipmentPayload, CreateShipmentResponse } from "./itd.js";

function countryCodeFromLabel(country: string | undefined): string {
  const c = (country ?? "").trim();
  if (c.length === 2) return c.toUpperCase();
  if (/^india/i.test(c)) return "IN";
  if (/^united states|^usa|^u\.s\.?a?/i.test(c)) return "US";
  return c.length >= 2 ? c.slice(0, 2).toUpperCase() : "IN";
}

function parseOptionalAmount(value: string | undefined): number | null {
  if (value === undefined || value === null || value === "") return null;
  const n = parseFloat(String(value).replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

function parseWeightKg(payload: CreateShipmentPayload): number | null {
  const n = parseFloat(payload.actual_weight);
  return Number.isFinite(n) ? n : null;
}

function parsePieces(payload: CreateShipmentPayload): number | null {
  const n = parseInt(payload.pcs, 10);
  return Number.isFinite(n) ? n : null;
}

function parseDeclaredValue(payload: CreateShipmentPayload): number | null {
  const n = parseFloat(payload.shipment_value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Fire-and-forget DB persistence after successful ITD create_docket.
 * Uses only safeQuery/safeQueryOne; logs and returns on any failure.
 *
 * `options.notifyDispatch` controls the "your parcel has shipped" WhatsApp
 * below. It defaults to true because the direct-docket path this was written
 * for dockets a parcel that is already with us. The booking path passes false:
 * there the docket is issued the moment the customer taps Confirm, with the
 * parcel still in their house, and telling them it has shipped would be a lie
 * they can act on. Their dispatch message comes later from `notify.ts`, keyed
 * on the order reaching `dispatched`.
 */
export async function persistShipmentAfterCreate(
  dbUserId: string,
  payload: CreateShipmentPayload,
  itdResponse: CreateShipmentResponse,
  ipAddress: string | undefined,
  options?: { notifyDispatch?: boolean }
): Promise<void> {
  if (!itdResponse.success || !itdResponse.data?.awb_no) {
    return;
  }

  const awb = itdResponse.data.awb_no;
  const bookingDate = new Date().toISOString().split("T")[0];

  const senderCountryCode = countryCodeFromLabel(payload.shipper_country);
  const recipientCountryCode = countryCodeFromLabel(payload.consignee_country);

  const senderRow = await findOrCreateAddress({
    user_id: dbUserId,
    type: "sender",
    full_name: payload.shipper_name,
    company: payload.shipper_company_name || null,
    email: payload.shipper_email || null,
    phone: payload.shipper_contact_no,
    address_line_1: payload.shipper_address_line_1,
    city: payload.shipper_city,
    state: payload.shipper_state || null,
    pincode: payload.shipper_zip_code || null,
    country_code: senderCountryCode,
    country_name: payload.shipper_country || null,
  });

  if (!senderRow?.id) {
    console.error("[persistShipment] sender address insert failed");
    return;
  }

  const recipientRow = await findOrCreateAddress({
    user_id: dbUserId,
    type: "recipient",
    full_name: payload.consignee_name,
    company: payload.consignee_company_name || null,
    email: payload.consignee_email || null,
    phone: payload.consignee_contact_no,
    address_line_1: payload.consignee_address_line_1,
    city: payload.consignee_city,
    state: payload.consignee_state || null,
    pincode: payload.consignee_zip_code || null,
    country_code: recipientCountryCode,
    country_name: payload.consignee_country || null,
  });

  if (!recipientRow?.id) {
    console.error("[persistShipment] recipient address insert failed");
    return;
  }

  const remoteCharges = parseOptionalAmount(itdResponse.data.remote_area_charges);
  const totalAmount = remoteCharges;

  const shipmentRow = await insertShipmentAndReturnId({
    user_id: dbUserId,
    awb_number: awb,
    sender_address_id: senderRow.id,
    recipient_address_id: recipientRow.id,
    sender_name: payload.shipper_name,
    sender_company: payload.shipper_company_name || null,
    sender_phone: payload.shipper_contact_no,
    sender_city: payload.shipper_city,
    sender_state: payload.shipper_state || null,
    sender_country: payload.shipper_country || null,
    consignee_name: payload.consignee_name,
    consignee_company: payload.consignee_company_name || null,
    consignee_phone: payload.consignee_contact_no,
    consignee_city: payload.consignee_city,
    consignee_state: payload.consignee_state || null,
    consignee_country: payload.consignee_country || null,
    service_name: payload.api_service_code || null,
    service_code: payload.product_code || null,
    product_code: payload.product_code || null,
    origin_country: senderCountryCode,
    destination_country: recipientCountryCode,
    weight_kg: parseWeightKg(payload),
    pieces: parsePieces(payload),
    declared_value: parseDeclaredValue(payload),
    currency: payload.shipment_value_currency || "INR",
    invoice_number: payload.shipment_invoice_no || null,
    contents_description: payload.shipment_content || null,
    total_amount: totalAmount,
    other_charges: remoteCharges,
    current_status: "ENTRY",
    booking_date: bookingDate,
    itd_response: itdResponse,
  });

  if (!shipmentRow?.id) {
    console.error("[persistShipment] shipment insert failed");
    return;
  }

  const notifBody = `Your shipment has been booked. AWB: ${awb}`;

  await insertShipmentCreatedNotification({
    user_id: dbUserId,
    title: "Shipment Booked",
    body: notifBody,
    data: { awb },
    shipment_id: shipmentRow.id,
  });

  // The parcel is now trackable, so tell the customer where.
  //
  // This path books a docket directly and never touches an order, so there is
  // no order number to quote — the AWB is the only reference the customer has,
  // and it is passed as both. The ops `generate_docket` path quotes both
  // properly, through the status fan-out in `notify.ts`.
  if (options?.notifyDispatch !== false) {
    void notifyDispatched({
      userId: dbUserId,
      orderNo: awb,
      awb,
      orderId: null,
    });
  }

  await insertShipmentCreatedAuditLog({
    user_id: dbUserId,
    entity_id: awb,
    metadata: {
      awb_number: awb,
      docket_id: itdResponse.data.docket_id,
      shipment_id: shipmentRow.id,
    },
    ip_address: ipAddress ?? null,
  });
}
