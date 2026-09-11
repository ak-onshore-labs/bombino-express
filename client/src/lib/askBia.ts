import { explainError, isErrorCode } from '@shared/errorCatalog';
import type { BiaScreen } from '@shared/biaScreen';
import { parseApiErrorCode, parseApiErrorMessage } from './apiError';
import { openBia } from './biaStore';

/**
 * Turning "something went wrong" into a question for BIA.
 *
 * The error's catalogued code rides in the screen context, where the server
 * turns it into an explanation for the prompt (shared/errorCatalog.ts). The
 * seed is the customer's side of it: the message they would have typed.
 */

/** The screen a path belongs to, for the support button. */
export function screenForPath(path: string): BiaScreen {
  const order = path.match(/^\/order\/(BOM-\d{6,9})$/i);
  if (order) return { surface: 'order', orderNo: order[1].toUpperCase() };
  if (path === '/create') return { surface: 'create' };
  if (path === '/orders') return { surface: 'orders' };
  if (path === '/signup') return { surface: 'signup' };
  if (path === '/rates') return { surface: 'rates' };
  if (path === '/profile') return { surface: 'documents' };
  if (path === '/help') return { surface: 'help' };
  if (path.startsWith('/guest-profile')) return { surface: 'guest_profile' };
  if (path === '/track' || path === '/receive' || path.startsWith('/shipment/')) return { surface: 'track' };
  return { surface: 'home' };
}

/**
 * The first message for an error: its catalogued title when there is one,
 * otherwise the words the customer saw. Undefined when there is nothing to say.
 */
export function seedForError(code: string | null | undefined, message: string | null | undefined): string | undefined {
  const known = explainError(code);
  if (known) return `I got this error: "${known.title}". What do I do?`;
  const words = (message ?? '').trim().replace(/\s+/g, ' ');
  if (!words) return undefined;
  return `I got this message: "${words.length > 200 ? `${words.slice(0, 197)}...` : words}". What do I do?`;
}

/** Open BIA about an error that is already on screen. */
export function askBiaAbout(
  screen: Omit<BiaScreen, 'errorCode'>,
  code: string | null | undefined,
  message: string | null | undefined
): void {
  openBia({
    screen: isErrorCode(code) ? { ...screen, errorCode: code } : screen,
    seed: seedForError(code, message),
  });
}

/** Open BIA about a failed API call, straight from its error. */
export function askBia(err: unknown, screen: Omit<BiaScreen, 'errorCode'>): void {
  askBiaAbout(screen, parseApiErrorCode(err), parseApiErrorMessage(err, ''));
}
