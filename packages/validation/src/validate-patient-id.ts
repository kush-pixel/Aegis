/**
 * Validates a patient ID string.
 * Returns true if the id contains at least one non-whitespace character.
 */
export function validatePatientId(id: string): boolean {
  return id.trim().length > 0;
}
