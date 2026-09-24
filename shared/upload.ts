/**
 * What an upload may be, agreed by the browser and the server.
 *
 * The limit is 4MB, not 5: a serverless request body is capped at 4.5MB on
 * Vercel and the platform rejects the request before multer sees it — which
 * reaches the customer as a bare 413 with no JSON body and no way to say why.
 * Staying under the cap keeps the error ours.
 *
 * Both numbers used to be written twice in the client and once in the server,
 * each copy carrying a comment asking the others to be kept in step.
 */

export const ALLOWED_UPLOAD_MIME_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
] as const;

export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

export const UPLOAD_TYPE_MESSAGE = "Only PDF, JPEG, and PNG files are accepted.";

export const UPLOAD_SIZE_MESSAGE = "File too large. Maximum size is 4MB.";

export function isAllowedUploadType(mimeType: string): boolean {
  return (ALLOWED_UPLOAD_MIME_TYPES as readonly string[]).includes(mimeType);
}
