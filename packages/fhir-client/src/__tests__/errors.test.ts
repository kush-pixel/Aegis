import { FhirNotFoundError, FhirValidationError } from '../errors';

describe('FhirNotFoundError', () => {
  it('sets message to resourceType/id not found', () => {
    const err = new FhirNotFoundError('Patient', 'abc-123');
    expect(err.message).toBe('Patient/abc-123 not found');
  });

  it('sets name to FhirNotFoundError', () => {
    const err = new FhirNotFoundError('Patient', 'abc-123');
    expect(err.name).toBe('FhirNotFoundError');
  });

  it('is an instance of Error', () => {
    const err = new FhirNotFoundError('Patient', 'abc-123');
    expect(err).toBeInstanceOf(Error);
  });

  it('is an instance of FhirNotFoundError', () => {
    const err = new FhirNotFoundError('Patient', 'abc-123');
    expect(err).toBeInstanceOf(FhirNotFoundError);
  });

  it('is not an instance of FhirValidationError', () => {
    const err = new FhirNotFoundError('Patient', 'abc-123');
    expect(err).not.toBeInstanceOf(FhirValidationError);
  });

  it('works with Condition resource type', () => {
    const err = new FhirNotFoundError('Condition', 'xyz-456');
    expect(err.message).toBe('Condition/xyz-456 not found');
  });
});

describe('FhirValidationError', () => {
  it('sets message correctly', () => {
    const err = new FhirValidationError('invalid lace_score');
    expect(err.message).toBe('invalid lace_score');
  });

  it('sets name to FhirValidationError', () => {
    const err = new FhirValidationError('invalid lace_score');
    expect(err.name).toBe('FhirValidationError');
  });

  it('is an instance of Error', () => {
    const err = new FhirValidationError('msg');
    expect(err).toBeInstanceOf(Error);
  });

  it('is an instance of FhirValidationError', () => {
    const err = new FhirValidationError('msg');
    expect(err).toBeInstanceOf(FhirValidationError);
  });

  it('is not an instance of FhirNotFoundError', () => {
    const err = new FhirValidationError('msg');
    expect(err).not.toBeInstanceOf(FhirNotFoundError);
  });
});
