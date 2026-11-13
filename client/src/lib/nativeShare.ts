import { getCapacitorShare, getCapacitorFilesystem } from './platform';

const DIRECTORY_CACHE = 'CACHE';

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? '');
      resolve(result.slice(result.indexOf(',') + 1));
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/**
 * Hand a file to the app shell's share sheet: written to the cache, then
 * shared from there. False when a plugin is missing or anything fails, so the
 * caller can fall back to the browser's way.
 */
export async function shareFileViaCapacitor({
  fileName,
  mimeType,
  data,
  title,
}: {
  fileName: string;
  mimeType: string;
  /** Base64 without a data: prefix, or the file itself. */
  data: string | Blob;
  title: string;
}): Promise<boolean> {
  const Share = getCapacitorShare();
  const Filesystem = getCapacitorFilesystem();
  if (!Share || !Filesystem) return false;

  try {
    const base64 =
      typeof data === 'string'
        ? data
        : await blobToBase64(data.type ? data : new Blob([data], { type: mimeType }));
    const writeResult = await Filesystem.writeFile({
      path: fileName,
      data: base64,
      directory: DIRECTORY_CACHE,
      recursive: true,
    });

    let uri: string | undefined = writeResult?.uri;
    if (!uri) {
      const got = await Filesystem.getUri({ path: fileName, directory: DIRECTORY_CACHE });
      uri = got?.uri;
    }
    if (!uri) return false;

    await Share.share({ title, files: [uri], dialogTitle: title });
    return true;
  } catch {
    return false;
  }
}

export function shareViaCapacitor(
  base64: string,
  fileName: string,
  title: string
): Promise<boolean> {
  return shareFileViaCapacitor({ fileName, mimeType: 'application/pdf', data: base64, title });
}
