/**
 * Generates a unique call identifier.
 * Format: CALL-<hex timestamp> where the hex portion is Date.now() in base-16.
 */
export function generateCallId(): string {
  return `CALL-${Date.now().toString(16)}`;
}
