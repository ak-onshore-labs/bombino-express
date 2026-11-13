/**
 * A4 — the Razorpay Checkout modal, from the client's side.
 *
 * One exported function: `payForOrder(orderId)` takes an order that exists in
 * our database and returns how the attempt ended. Everything the gateway needs
 * — key, amount, gateway order id — comes from our server, never from the
 * caller: an amount chosen in the browser is an amount the customer can edit.
 *
 * The important thing about the return value is that **only `'paid'` is a
 * promise**. A dismissed modal is not a failure — the order is already booked
 * and payable later — and `'pending'` means the money very likely moved but we
 * could not confirm it in time. The webhook settles both cases server-side, so
 * the UI's job is to stop claiming certainty it does not have.
 *
 * TEMPORARY: when the test switch is on (`lib/paymentsTestMode.ts`) this skips
 * the gateway entirely and asks the server to settle the order. Same signature,
 * same outcomes, so no caller changes. Both go when Razorpay works.
 */

import { apiRequest } from './queryClient';
import { isTestModeSkipOn } from './paymentsTestMode';
import { isEdgeToEdgeShell } from './platform';
import { acquireLightIcons, releaseLightIcons } from './statusBar';

const CHECKOUT_SRC = 'https://checkout.razorpay.com/v1/checkout.js';

type RazorpayCheckoutResponse = {
  razorpay_payment_id: string;
  razorpay_order_id: string;
  razorpay_signature: string;
};

type RazorpayOptions = {
  key: string;
  amount: number;
  currency: string;
  name: string;
  description?: string;
  order_id: string;
  handler: (response: RazorpayCheckoutResponse) => void;
  prefill?: { name?: string; email?: string; contact?: string };
  notes?: Record<string, string>;
  theme?: { color?: string };
  modal?: { ondismiss?: () => void };
  /** Offer UPI apps (GPay, PhonePe, Paytm) from inside a WebView. */
  webview_intent?: boolean;
};

type RazorpayInstance = {
  open: () => void;
  on: (event: string, handler: (payload: unknown) => void) => void;
};

declare global {
  interface Window {
    Razorpay?: new (options: RazorpayOptions) => RazorpayInstance;
  }
}

type GatewayOrderResponse = {
  key_id: string;
  razorpay_order_id: string;
  amount: number; // paise
  currency: string;
  order_no: string;
  prefill: { name: string; contact: string };
};

type VerifyResponse = {
  paid?: boolean;
  payment_status?: string;
  amount?: number;
  reference?: string;
  txn_id?: string | null;
};

export type PaymentOutcome =
  | { status: 'paid'; amount?: number; reference?: string }
  /** Customer closed the modal. The order stands, unpaid. */
  | { status: 'dismissed' }
  /** Money probably moved; confirmation did not arrive in time. */
  | { status: 'pending'; message: string }
  | { status: 'failed'; message: string };

let scriptPromise: Promise<boolean> | null = null;

/**
 * Inject checkout.js once per page load.
 *
 * Memoised on the promise rather than on a boolean, so two components asking
 * at the same moment wait on the same script tag instead of racing to add two.
 */
function loadCheckoutScript(): Promise<boolean> {
  if (window.Razorpay) return Promise.resolve(true);
  if (scriptPromise) return scriptPromise;

  scriptPromise = new Promise<boolean>((resolve) => {
    const script = document.createElement('script');
    script.src = CHECKOUT_SRC;
    script.async = true;
    script.onload = () => resolve(true);
    script.onerror = () => {
      // Let a later attempt retry — a blocked-then-unblocked network or an ad
      // blocker the customer turns off should not need a page reload.
      scriptPromise = null;
      resolve(false);
    };
    document.body.appendChild(script);
  });

  return scriptPromise;
}

/** Strip the `409: ` status prefix `apiRequest` puts on thrown errors. */
function cleanMessage(err: unknown, fallback: string): string {
  if (!(err instanceof Error)) return fallback;
  const raw = err.message.replace(/^\d+:\s*/, '');
  try {
    const parsed = JSON.parse(raw) as { message?: string };
    return parsed.message ?? raw ?? fallback;
  } catch {
    return raw || fallback;
  }
}

/**
 * TEMPORARY — settle without the gateway, when test mode is switched on.
 *
 * Lives behind the same `payForOrder` call as the real thing so no screen has
 * to know about it: both call sites (booking, and Pay now on the order) keep
 * one code path and one set of outcomes.
 *
 * The switch is only a request. The server refuses with 404 unless
 * `PAYMENTS_TEST_MODE=1` is set there, and that refusal is reported plainly
 * rather than falling through to checkout — silently charging a card because a
 * test flag was ignored is the one outcome worth being loud about.
 */
async function settleInTestMode(orderId: string): Promise<PaymentOutcome> {
  try {
    const res = await apiRequest('POST', '/api/payments/test/settle', { order_id: orderId });
    const body = (await res.json()) as VerifyResponse;
    if (!body.paid) {
      return { status: 'failed', message: 'The test settle did not report the order paid.' };
    }
    return { status: 'paid', amount: body.amount, reference: body.reference };
  } catch (err) {
    const message = cleanMessage(err, 'Could not settle this order in test mode.');
    if (err instanceof Error && /^404:/.test(err.message)) {
      return {
        status: 'failed',
        message: 'Test mode is off on the server. Set PAYMENTS_TEST_MODE=1 there, or turn the switch off to pay through Razorpay.',
      };
    }
    return { status: 'failed', message };
  }
}

export async function payForOrder(orderId: string): Promise<PaymentOutcome> {
  if (isTestModeSkipOn()) return settleInTestMode(orderId);

  let gateway: GatewayOrderResponse;
  try {
    const res = await apiRequest('POST', '/api/payments/razorpay/order', { order_id: orderId });
    gateway = (await res.json()) as GatewayOrderResponse;
  } catch (err) {
    return { status: 'failed', message: cleanMessage(err, 'Could not start the payment.') };
  }

  const loaded = await loadCheckoutScript();
  if (!loaded || !window.Razorpay) {
    return {
      status: 'failed',
      message: 'Could not load the payment window. Check your connection and try again.',
    };
  }

  return new Promise<PaymentOutcome>((resolve) => {
    // Checkout can fire both a handler and a dismiss for one session
    // (dismiss follows the redirect back). First outcome wins.
    let settled = false;
    let chromeOn = false;
    // Checkout covers the whole screen; in the edge-to-edge shell its frame is
    // inset below the status bar (html.rzp-open in index.css), over a band in
    // the theme colour, so the status bar wants light icons meanwhile.
    const chromeOff = (): void => {
      if (!chromeOn) return;
      chromeOn = false;
      document.documentElement.classList.remove('rzp-open');
      releaseLightIcons();
    };
    const settle = (outcome: PaymentOutcome): void => {
      if (settled) return;
      settled = true;
      chromeOff();
      resolve(outcome);
    };

    try {
      openCheckout(gateway, orderId, settle, () => {
        chromeOn = true;
        document.documentElement.classList.add('rzp-open');
        acquireLightIcons();
      });
    } catch (err) {
      settle({ status: 'failed', message: cleanMessage(err, 'Could not open the payment window.') });
    }
  });
}

/** Build and open the checkout modal. Every outcome goes through `settle`. */
function openCheckout(
  gateway: GatewayOrderResponse,
  orderId: string,
  settle: (outcome: PaymentOutcome) => void,
  beforeOpen: () => void,
): void {
  const checkout = new window.Razorpay!({
    key: gateway.key_id,
    amount: gateway.amount,
    currency: gateway.currency,
    name: 'Bombino Express',
    description: `Order ${gateway.order_no}`,
    order_id: gateway.razorpay_order_id,
    prefill: {
      name: gateway.prefill?.name || undefined,
      contact: gateway.prefill?.contact || undefined,
    },
    notes: { order_no: gateway.order_no },
    theme: { color: '#14567C' },
    ...(isEdgeToEdgeShell() ? { webview_intent: true } : {}),
    modal: {
      ondismiss: () => settle({ status: 'dismissed' }),
    },
    handler: (response) => {
      void (async () => {
        try {
          const res = await apiRequest('POST', '/api/payments/razorpay/verify', {
            order_id: orderId,
            razorpay_order_id: response.razorpay_order_id,
            razorpay_payment_id: response.razorpay_payment_id,
            razorpay_signature: response.razorpay_signature,
          });

          const body = (await res.json()) as VerifyResponse;

          // 202 — the server took the payment but could not confirm it
          // synchronously. The webhook will finish the job.
          if (res.status === 202 || !body.paid) {
            settle({
              status: 'pending',
              message: 'Payment received — confirming it now.',
            });
            return;
          }

          settle({ status: 'paid', amount: body.amount, reference: body.reference });
        } catch (err) {
          // The charge may still be real: verification failing is not the
          // same as payment failing, and only the webhook knows which.
          settle({
            status: 'pending',
            message: cleanMessage(err, 'We could not confirm the payment yet.'),
          });
        }
      })();
    },
  });

  checkout.on('payment.failed', (payload) => {
    const description = (payload as { error?: { description?: string } })?.error?.description;
    settle({ status: 'failed', message: description ?? 'That payment did not go through.' });
  });

  beforeOpen();
  checkout.open();
}
