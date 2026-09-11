/**
 * BIA's button tokens, parsed out of an assistant message.
 *
 * The server (`server/supportCta.ts`) validates every token before it is sent
 * and puts each on its own line at the end, so this only has to recognise the
 * vocabulary. Add a token in both places or in neither. Stored transcripts keep
 * the tokens, so a restored conversation gets its buttons back.
 */

export type SupportCta =
  | { kind: 'create_shipment' }
  | { kind: 'contact_us' }
  | { kind: 'my_orders' }
  | { kind: 'cancellations' }
  | { kind: 'guest_profile' }
  | { kind: 'locations'; state: string | null }
  | { kind: 'track'; awb: string }
  | { kind: 'view_order'; orderNo: string };

export interface ParsedMessage {
  text: string;
  ctas: SupportCta[];
}

const TOKEN_RE = /TAP_[A-Z_]+(?::[^\s]+)?/g;

function toCta(token: string): SupportCta | null {
  const colon = token.indexOf(':');
  const name = colon === -1 ? token : token.slice(0, colon);
  const arg = colon === -1 ? '' : token.slice(colon + 1);

  switch (name) {
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
    case 'TAP_LOCATIONS': {
      let state: string | null = null;
      if (arg) {
        try {
          state = decodeURIComponent(arg);
        } catch {
          state = null;
        }
      }
      return { kind: 'locations', state };
    }
    case 'TAP_TRACK':
      return /^[A-Za-z0-9-]{4,32}$/.test(arg) ? { kind: 'track', awb: arg } : null;
    case 'TAP_VIEW_ORDER':
      return /^BOM-\d{6,9}$/.test(arg) ? { kind: 'view_order', orderNo: arg } : null;
    default:
      return null;
  }
}

function ctaKey(cta: SupportCta): string {
  switch (cta.kind) {
    case 'locations':
      return `locations:${cta.state ?? ''}`;
    case 'track':
      return `track:${cta.awb}`;
    case 'view_order':
      return `view_order:${cta.orderNo}`;
    default:
      return cta.kind;
  }
}

export function parseAssistantMessage(content: string): ParsedMessage {
  const ctas: SupportCta[] = [];
  const seen = new Set<string>();
  for (const token of content.match(TOKEN_RE) ?? []) {
    const cta = toCta(token);
    if (!cta) continue;
    const key = ctaKey(cta);
    if (seen.has(key)) continue;
    seen.add(key);
    ctas.push(cta);
  }

  const text = content
    .replace(TOKEN_RE, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return { text, ctas };
}
