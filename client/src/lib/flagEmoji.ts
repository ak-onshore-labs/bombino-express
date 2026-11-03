/**
 * Whether this device draws flag emoji as flags.
 *
 * Phones and Macs do. Windows does not: it draws 🇶🇦 as the two letters "QA",
 * which is what made the country pill look broken on the sign-in page. Drawn
 * once onto a canvas — a real flag has colour, the letter fallback does not.
 */
let cached: boolean | null = null;

export function supportsFlagEmoji(): boolean {
  if (cached !== null) return cached;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 24;
    canvas.height = 24;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return (cached = false);
    ctx.font = '20px sans-serif';
    ctx.textBaseline = 'top';
    ctx.fillText('\u{1F1EE}\u{1F1F3}', 0, 0);
    const { data } = ctx.getImageData(0, 0, 24, 24);
    for (let i = 0; i < data.length; i += 4) {
      const [r, g, b, a] = [data[i], data[i + 1], data[i + 2], data[i + 3]];
      if (a > 0 && (Math.abs(r - g) > 30 || Math.abs(g - b) > 30 || Math.abs(r - b) > 30)) {
        return (cached = true);
      }
    }
    return (cached = false);
  } catch {
    return (cached = false);
  }
}
