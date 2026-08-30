/**
 * The customer contract a new account signs on its way in.
 *
 * The operative text is a document, not a list of clauses in this file:
 * client/public/contract-2026.pdf, the Bombino Express customer contract
 * dated 1 January 2026. It is served from the app rather than living only in
 * a mailbox, so an acceptance can be read back later against the exact pages
 * that were on offer when it was made.
 *
 * Signing is typed, not uploaded: at the last step the customer ticks
 * acceptance and types their name. Corporate accounts still hand over a
 * countersigned copy as the authorization letter — page 4 of the document
 * asks for a signature and rubber stamp on all pages by an authorised
 * signatory, which a typed name is not, so the two are different artefacts
 * and both are kept.
 *
 * `CONTRACT_VERSION` is stamped onto every acceptance. Never change the
 * document without bumping it.
 */

/**
 * Bumped from the bare "CONTRACT-2026" when the PDF replaced the six summary
 * clauses that used to stand in for it. Acceptances already carrying the old
 * value agreed to that summary and not to this document — pointing the same
 * string at both would make the stored record claim otherwise.
 */
export const CONTRACT_VERSION = "CONTRACT-2026-01-01";
export const CONTRACT_TITLE = "Bombino Express Customer Contract (2026)";

/**
 * Where the blank document lives.
 *
 * client/public is copied into dist/public by the client build and served by
 * Vite in development, so the path is the same either way and there is no
 * route to keep in step. server/contractPdf.ts reads the same file off disk
 * to stamp the signature into it.
 *
 * The signing screen does NOT link here. What a customer is shown is the
 * signed copy from POST /api/signup/contract/preview, because a blank form is
 * not the thing they are agreeing to. This stays exported as the one place
 * the filename is written down, and because a blank copy is worth being able
 * to hand someone.
 */
export const CONTRACT_PDF_PATH = "/contract-2026.pdf";
/** Shown beside the link, so nobody taps it expecting a page of text. */
export const CONTRACT_PAGE_COUNT = 4;

/**
 * What a signature has to be for us to hold someone to it.
 * Names are typed by hand, so this is deliberately forgiving about
 * punctuation and initials while still refusing an empty or joke entry.
 */
export const SIGNATURE_PATTERN = /^[A-Za-z][A-Za-z.'\- ]{1,79}$/;
export const SIGNATURE_MAX_LENGTH = 80;
export const SIGNATURE_ERROR = "Type your full name as your signature";

export function isValidSignature(name: string): boolean {
  return SIGNATURE_PATTERN.test(name.trim());
}
