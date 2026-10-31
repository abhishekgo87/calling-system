/**
 * Normalizes any phone number string into the last 10 digits.
 * Strips non-digit characters (+, spaces, dashes, parentheses).
 * Example: "+91 98765 43210" -> "9876543210"
 * Example: "09876543210" -> "9876543210"
 */
export function normalizePhone(rawPhone: string): string {
  if (!rawPhone) {
    return '';
  }
  const digitsOnly = rawPhone.replace(/\D/g, '');
  if (digitsOnly.length > 10) {
    return digitsOnly.slice(-10);
  }
  return digitsOnly;
}

/**
 * Validates whether a phone number string resolves to a valid 10-digit number.
 */
export function isValidTenDigitPhone(rawPhone: string): boolean {
  const normalized = normalizePhone(rawPhone);
  return /^\d{10}$/.test(normalized);
}
