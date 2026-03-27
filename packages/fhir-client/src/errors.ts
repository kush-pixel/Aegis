export class FhirNotFoundError extends Error {
  constructor(resourceType: string, id: string) {
    super(`${resourceType}/${id} not found`);
    this.name = 'FhirNotFoundError';
    Object.setPrototypeOf(this, FhirNotFoundError.prototype);
  }
}

export class FhirValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FhirValidationError';
    Object.setPrototypeOf(this, FhirValidationError.prototype);
  }
}
