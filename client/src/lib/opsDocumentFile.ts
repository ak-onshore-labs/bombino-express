/**
 * Naming a document a reviewer keeps a copy of.
 *
 * A saved file should be findable later: the document's own label, cleaned of
 * anything a filesystem rejects, carrying the extension the bytes actually are
 * — a slot labelled ".pdf" that came back as a photo saves as .jpg.
 */

const EXTENSION_BY_MIME: Readonly<Record<string, string>> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'image/heif': 'heif',
  'image/tiff': 'tiff',
};

export function opsDocumentFilename(title: string, mime: string): string {
  const base =
    title
      .replace(/[\\/:*?"<>|]/g, '-')
      .replace(/\s+/g, ' ')
      .trim() || 'document';
  const ext = EXTENSION_BY_MIME[mime.split(';')[0].trim().toLowerCase()];
  if (!ext) return base;
  const stem = base.replace(/\.(pdf|jpe?g|png|webp|heic|heif|tiff?)$/i, '');
  return `${stem}.${ext}`;
}
