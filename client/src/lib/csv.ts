/**
 * Dumb CSV helpers for ops exports. Headers + cells only — column maps live
 * next to each screen. RFC 4180 escaping with a UTF-8 BOM so Excel keeps
 * names and currency symbols intact.
 */

import { isEdgeToEdgeShell } from './platform';
import { shareFileViaCapacitor } from './nativeShare';

export type CsvCell = string | number | boolean | null | undefined;

function escapeCsvCell(value: CsvCell): string {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/** RFC 4180 CSV string with a leading UTF-8 BOM. */
export function toCsv(headers: string[], rows: CsvCell[][]): string {
  const lines = [
    headers.map(escapeCsvCell).join(','),
    ...rows.map((row) => row.map(escapeCsvCell).join(',')),
  ];
  return `\uFEFF${lines.join('\n')}`;
}

/**
 * Trigger a browser file download for a CSV built from headers + rows. The
 * edge-to-edge app shell, whose web view ignores `download`, shares it.
 */
export function downloadCsv(
  filename: string,
  headers: string[],
  rows: CsvCell[][],
): void {
  const csv = toCsv(headers, rows);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  if (!isEdgeToEdgeShell()) {
    browserDownload(blob, filename);
    return;
  }
  void shareFileViaCapacitor({ fileName: filename, mimeType: 'text/csv', data: blob, title: filename }).then(
    (shared) => {
      if (!shared) browserDownload(blob, filename);
    },
  );
}

function browserDownload(blob: Blob, filename: string): void {
  const blobUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = blobUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(blobUrl);
}
