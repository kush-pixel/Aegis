export class BedrockThrottlingError extends Error {
  readonly cause?: unknown;

  constructor(message: string, options?: { cause?: unknown }) {
    super(message);
    this.cause = options?.cause;
    this.name = 'BedrockThrottlingError';
    Object.setPrototypeOf(this, BedrockThrottlingError.prototype);
  }
}

export class BedrockModelError extends Error {
  readonly cause?: unknown;

  constructor(message: string, options?: { cause?: unknown }) {
    super(message);
    this.cause = options?.cause;
    this.name = 'BedrockModelError';
    Object.setPrototypeOf(this, BedrockModelError.prototype);
  }
}

export class BedrockGuardrailError extends Error {
  readonly cause?: unknown;

  constructor(message: string, options?: { cause?: unknown }) {
    super(message);
    this.cause = options?.cause;
    this.name = 'BedrockGuardrailError';
    Object.setPrototypeOf(this, BedrockGuardrailError.prototype);
  }
}

export class BedrockKnowledgeBaseError extends Error {
  readonly cause?: unknown;

  constructor(message: string, options?: { cause?: unknown }) {
    super(message);
    this.cause = options?.cause;
    this.name = 'BedrockKnowledgeBaseError';
    Object.setPrototypeOf(this, BedrockKnowledgeBaseError.prototype);
  }
}
