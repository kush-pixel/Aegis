import {
  BedrockThrottlingError,
  BedrockModelError,
  BedrockGuardrailError,
  BedrockKnowledgeBaseError,
} from '../errors';

describe('BedrockThrottlingError', () => {
  it('sets name to BedrockThrottlingError', () => {
    const err = new BedrockThrottlingError('throttled');
    expect(err.name).toBe('BedrockThrottlingError');
  });

  it('preserves message', () => {
    const err = new BedrockThrottlingError('rate limited');
    expect(err.message).toBe('rate limited');
  });

  it('is instanceof Error', () => {
    const err = new BedrockThrottlingError('throttled');
    expect(err).toBeInstanceOf(Error);
  });

  it('is instanceof BedrockThrottlingError', () => {
    const err = new BedrockThrottlingError('throttled');
    expect(err).toBeInstanceOf(BedrockThrottlingError);
  });

  it('preserves cause when provided', () => {
    const original = new Error('original');
    const err = new BedrockThrottlingError('throttled', { cause: original });
    expect(err.cause).toBe(original);
  });

  it('cause is undefined when not provided', () => {
    const err = new BedrockThrottlingError('throttled');
    expect(err.cause).toBeUndefined();
  });
});

describe('BedrockModelError', () => {
  it('sets name to BedrockModelError', () => {
    const err = new BedrockModelError('model failed');
    expect(err.name).toBe('BedrockModelError');
  });

  it('preserves message', () => {
    const err = new BedrockModelError('timeout');
    expect(err.message).toBe('timeout');
  });

  it('is instanceof Error', () => {
    const err = new BedrockModelError('model failed');
    expect(err).toBeInstanceOf(Error);
  });

  it('is instanceof BedrockModelError', () => {
    const err = new BedrockModelError('model failed');
    expect(err).toBeInstanceOf(BedrockModelError);
  });

  it('preserves cause when provided', () => {
    const original = new Error('original');
    const err = new BedrockModelError('model failed', { cause: original });
    expect(err.cause).toBe(original);
  });

  it('cause is undefined when not provided', () => {
    const err = new BedrockModelError('model failed');
    expect(err.cause).toBeUndefined();
  });
});

describe('BedrockGuardrailError', () => {
  it('sets name to BedrockGuardrailError', () => {
    const err = new BedrockGuardrailError('blocked');
    expect(err.name).toBe('BedrockGuardrailError');
  });

  it('preserves message', () => {
    const err = new BedrockGuardrailError('content blocked');
    expect(err.message).toBe('content blocked');
  });

  it('is instanceof Error', () => {
    const err = new BedrockGuardrailError('blocked');
    expect(err).toBeInstanceOf(Error);
  });

  it('is instanceof BedrockGuardrailError', () => {
    const err = new BedrockGuardrailError('blocked');
    expect(err).toBeInstanceOf(BedrockGuardrailError);
  });

  it('preserves cause when provided', () => {
    const original = new Error('original');
    const err = new BedrockGuardrailError('blocked', { cause: original });
    expect(err.cause).toBe(original);
  });

  it('cause is undefined when not provided', () => {
    const err = new BedrockGuardrailError('blocked');
    expect(err.cause).toBeUndefined();
  });
});

describe('BedrockKnowledgeBaseError', () => {
  it('sets name to BedrockKnowledgeBaseError', () => {
    const err = new BedrockKnowledgeBaseError('not found');
    expect(err.name).toBe('BedrockKnowledgeBaseError');
  });

  it('preserves message', () => {
    const err = new BedrockKnowledgeBaseError('KB missing');
    expect(err.message).toBe('KB missing');
  });

  it('is instanceof Error', () => {
    const err = new BedrockKnowledgeBaseError('not found');
    expect(err).toBeInstanceOf(Error);
  });

  it('is instanceof BedrockKnowledgeBaseError', () => {
    const err = new BedrockKnowledgeBaseError('not found');
    expect(err).toBeInstanceOf(BedrockKnowledgeBaseError);
  });

  it('preserves cause when provided', () => {
    const original = new Error('original');
    const err = new BedrockKnowledgeBaseError('not found', { cause: original });
    expect(err.cause).toBe(original);
  });

  it('cause is undefined when not provided', () => {
    const err = new BedrockKnowledgeBaseError('not found');
    expect(err.cause).toBeUndefined();
  });
});
