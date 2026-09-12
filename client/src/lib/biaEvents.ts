/**
 * Fired on `window` after BIA's chat uploads a document (DocUploadCard), so a
 * screen already showing documents reads them again instead of showing the
 * old file. Detail: `{ target: 'account' | 'kyc', slot: string | null }`.
 */
export const DOCUMENTS_CHANGED_EVENT = 'bia:documents-changed';
