import { formatAadhaar } from '@shared/aadhaar';

/** `XXXX XXXX XXXX` — twelve digits and the two spaces between their groups. */
export const AADHAAR_DISPLAY_MAX_LENGTH = 14;

/**
 * An Aadhaar field's keystroke, split into what is kept and what is shown.
 *
 * The digits are the value — what is validated and sent. The grouped string is
 * only for the eye, set out as the card prints it so a slipped digit is easy
 * to find. Anything that is not a digit is dropped, which is also what makes a
 * number pasted with spaces or dashes land cleanly.
 *
 * Reformatting a controlled input moves the caret to the end, so an edit in
 * the middle of the number would throw the cursor out of place on every key.
 * The caret is put back after the same count of digits it was after before
 * the spaces moved, on the next frame — once React has written the new value.
 */
export function readAadhaarInput(input: HTMLInputElement): { digits: string; display: string } {
  const digits = input.value.replace(/\D/g, '').slice(0, 12);
  const display = formatAadhaar(digits);

  const caret = input.selectionStart ?? input.value.length;
  const digitsBeforeCaret = input.value.slice(0, caret).replace(/\D/g, '').length;

  requestAnimationFrame(() => {
    if (document.activeElement !== input) return;
    let pos = 0;
    let seen = 0;
    while (pos < input.value.length && seen < digitsBeforeCaret) {
      if (/\d/.test(input.value[pos])) seen++;
      pos++;
    }
    input.setSelectionRange(pos, pos);
  });

  return { digits, display };
}
