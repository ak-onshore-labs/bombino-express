/**
 * BIA's button tokens, parsed out of an assistant message.
 *
 * The server (`server/supportCta.ts`) validates every token before it is sent
 * and puts each on its own line at the end. Which tokens exist and what they
 * may carry is `shared/biaCta.ts`, read by both ends, so the two cannot drift.
 * Stored transcripts keep the tokens, so a restored conversation gets its
 * buttons back.
 */

import { BIA_BUTTON_TOKEN_RE, parseBiaButton, splitOrderRef, type BiaButton, type OrderSection } from '@shared/biaCta';

export type SupportCta =
  | { kind: 'create_shipment' }
  | { kind: 'contact_us' }
  | { kind: 'my_orders' }
  | { kind: 'cancellations' }
  | { kind: 'guest_profile' }
  | { kind: 'locations'; state: string | null }
  | { kind: 'track'; awb: string }
  /** `section`: where on the order page it opens (#cancel, #handover-code, #pay). */
  | { kind: 'view_order'; orderNo: string; section: OrderSection | null }
  | { kind: 'signup'; choice: string }
  | { kind: 'resume_signup'; choice: string }
  | { kind: 'account_documents' }
  | { kind: 'case_whatsapp'; caseNo: string };

export interface ParsedMessage {
  text: string;
  ctas: SupportCta[];
}

function toCta(button: BiaButton): SupportCta {
  switch (button.name) {
    case 'TAP_CREATE_SHIPMENT':
      return { kind: 'create_shipment' };
    case 'TAP_CONTACT_US':
      return { kind: 'contact_us' };
    case 'TAP_MY_ORDERS':
      return { kind: 'my_orders' };
    case 'TAP_CANCELLATIONS':
      return { kind: 'cancellations' };
    case 'TAP_GUEST_PROFILE':
      return { kind: 'guest_profile' };
    case 'TAP_LOCATIONS':
      // The registry keeps the state percent-encoded, as the token carries it.
      return { kind: 'locations', state: button.arg ? decodeURIComponent(button.arg) : null };
    case 'TAP_TRACK':
      return { kind: 'track', awb: button.arg };
    case 'TAP_VIEW_ORDER':
      return { kind: 'view_order', ...splitOrderRef(button.arg) };
    case 'TAP_SIGNUP':
      return { kind: 'signup', choice: button.arg };
    case 'TAP_RESUME_SIGNUP':
      return { kind: 'resume_signup', choice: button.arg };
    case 'TAP_ACCOUNT_DOCUMENTS':
      return { kind: 'account_documents' };
    case 'TAP_CASE_WHATSAPP':
      return { kind: 'case_whatsapp', caseNo: button.arg };
  }
}

function ctaKey(cta: SupportCta): string {
  switch (cta.kind) {
    case 'locations':
      return `locations:${cta.state ?? ''}`;
    case 'track':
      return `track:${cta.awb}`;
    case 'view_order':
      return `view_order:${cta.orderNo}#${cta.section ?? ''}`;
    case 'signup':
      return `signup:${cta.choice}`;
    case 'resume_signup':
      return `resume_signup:${cta.choice}`;
    case 'case_whatsapp':
      return `case_whatsapp:${cta.caseNo}`;
    default:
      return cta.kind;
  }
}

export function parseAssistantMessage(content: string): ParsedMessage {
  const ctas: SupportCta[] = [];
  const seen = new Set<string>();
  for (const token of content.match(BIA_BUTTON_TOKEN_RE) ?? []) {
    const button = parseBiaButton(token);
    if (!button) continue;
    const cta = toCta(button);
    const key = ctaKey(cta);
    if (seen.has(key)) continue;
    seen.add(key);
    ctas.push(cta);
  }

  const text = content
    .replace(BIA_BUTTON_TOKEN_RE, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return { text, ctas };
}
