/**
 * One slot's state, shared by the list that owns it and the card that renders
 * it. Lifted out of `AccountDocuments.tsx` when the card became its own file.
 */

export type SlotStatus = 'idle' | 'pending' | 'uploading' | 'success' | 'unverified' | 'error';

export interface SlotState {
  status: SlotStatus;
  documentNo: string;
  /**
   * True once the server holds this slot's number in identity_verifications.
   *
   * The upload endpoint takes the number it compares against from that row,
   * not from the request, and 422s when there is none — so for a slot that
   * carries a number, recording it is a precondition of uploading anything.
   * The field locks at the same moment, because the row is what the document
   * will be judged against and letting the two drift is the whole problem.
   */
  numberRecorded: boolean;
  /** In flight to the identity endpoint; the upload waits on it. */
  recording: boolean;
  fileName: string;
  error: string;
  /**
   * Why the document is not verified, when it is not. A contradicting number,
   * the wrong document or a tamper signal never gets this far — the server
   * refuses those uploads outright. What lands here is an unreadable scan or
   * an unreachable verifier, and account creation refuses both, so the slot
   * stays outstanding rather than showing as done.
   */
  ocrNote: string;
  /**
   * The catalogued code behind `error` or `ocrNote` (shared/errorCatalog.ts),
   * so "Ask BIA" knows which problem it is. Null when there is none.
   */
  errorCode: string | null;
}
