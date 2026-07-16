/**
 * GSTIN (Indian GST number) validation — shared across every GSTIN field so the
 * rules are consistent site-wide (A4).
 *
 * A GSTIN is 15 chars: 2-digit state code, 10-char PAN, 1 entity digit, a literal
 * 'Z', and a checksum char. Beyond the format we verify the official check digit
 * (the 15th char), computed over the first 14 with the GSTN modulo-36 algorithm.
 */

// Format: 2 digits · 5 letters · 4 digits · 1 letter · 1 alnum(1-9/A-Z) · 'Z' · 1 alnum
export const GSTIN_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

const CODE = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"; // index == code point value (0..35)

/** The official GSTN check digit for the first 14 chars of a GSTIN. */
export function gstinCheckDigit(first14: string): string {
  const mod = CODE.length; // 36
  let factor = 2;
  let sum = 0;
  for (let i = first14.length - 1; i >= 0; i--) {
    const cp = CODE.indexOf(first14[i]);
    if (cp < 0) return ""; // invalid char → no valid check digit
    let digit = factor * cp;
    factor = factor === 2 ? 1 : 2;
    digit = Math.floor(digit / mod) + (digit % mod);
    sum += digit;
  }
  return CODE[(mod - (sum % mod)) % mod];
}

/** Normalise for storage/comparison: trim + uppercase. */
export const normalizeGstin = (g: string): string => (g || "").trim().toUpperCase();

/** True when `g` matches the GSTIN format AND its check digit is correct. */
export function isValidGstin(g: string): boolean {
  const s = normalizeGstin(g);
  if (!GSTIN_REGEX.test(s)) return false;
  return gstinCheckDigit(s.slice(0, 14)) === s[14];
}

/**
 * Validate an optional GSTIN field. Empty is allowed (returns null); a non-empty
 * value must be a valid GSTIN. Returns an error message or null when acceptable.
 */
export function gstinError(g: string, { required = false }: { required?: boolean } = {}): string | null {
  const s = normalizeGstin(g);
  if (!s) return required ? "GST number is required" : null;
  if (!GSTIN_REGEX.test(s)) return "Enter a valid 15-character GSTIN (e.g. 33ABCDE1234F1Z5)";
  if (gstinCheckDigit(s.slice(0, 14)) !== s[14]) return "GSTIN checksum is invalid — check for a typo";
  return null;
}
