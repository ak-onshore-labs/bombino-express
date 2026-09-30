/**
 * What an upload may be, agreed by the browser and the server.
 *
 * 8MB. It was 4MB while the app ran on Vercel, whose serverless request body
 * cap of 4.5MB rejected anything larger before multer saw it. The app now runs
 * as a long-lived server on Railway, which has no such cap, and phone photos
 * of documents routinely exceed 4MB. If it ever moves back to a serverless
 * host, this has to drop under that host's body cap again.
 *
 * Both numbers used to be written twice in the client and once in the server,
 * each copy carrying a comment asking the others to be kept in step.
 */

export const ALLOWED_UPLOAD_MIME_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
] as const;

export const MAX_UPLOAD_MB = 8;

export const MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024;

export const UPLOAD_TYPE_MESSAGE = "Only PDF, JPEG, and PNG files are accepted.";

export const UPLOAD_SIZE_MESSAGE = `File too large. Maximum size is ${MAX_UPLOAD_MB}MB.`;

export function isAllowedUploadType(mimeType: string): boolean {
  return (ALLOWED_UPLOAD_MIME_TYPES as readonly string[]).includes(mimeType);
}
