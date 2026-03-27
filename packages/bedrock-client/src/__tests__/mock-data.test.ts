import {
  isMockMode,
  getMockProtocol,
  getMockExtractionResults,
  getMockSummary,
  getMockKBResults,
} from '../mock-data';
import {
  TriageProtocolSchema,
  ExtractionResultSchema,
  IsbarrSchema,
} from '@aegis/schemas';
import { KBResultSchema } from '../types';

describe('isMockMode', () => {
  const originalEnv = process.env['USE_BEDROCK_MOCK'];

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env['USE_BEDROCK_MOCK'];
    } else {
      process.env['USE_BEDROCK_MOCK'] = originalEnv;
    }
  });

  it('returns true when USE_BEDROCK_MOCK=true', () => {
    process.env['USE_BEDROCK_MOCK'] = 'true';
    expect(isMockMode()).toBe(true);
  });

  it('returns false when USE_BEDROCK_MOCK=false', () => {
    process.env['USE_BEDROCK_MOCK'] = 'false';
    expect(isMockMode()).toBe(false);
  });

  it('returns false when USE_BEDROCK_MOCK is unset', () => {
    delete process.env['USE_BEDROCK_MOCK'];
    expect(isMockMode()).toBe(false);
  });

  it('returns false for any value other than "true"', () => {
    process.env['USE_BEDROCK_MOCK'] = '1';
    expect(isMockMode()).toBe(false);
  });
});

describe('getMockProtocol', () => {
  it('passes TriageProtocolSchema validation', () => {
    const result = getMockProtocol('P001');
    expect(() => TriageProtocolSchema.parse(result)).not.toThrow();
  });

  it('includes the given patientId', () => {
    const result = getMockProtocol('P999');
    expect(result.patient_id).toBe('P999');
  });

  it('contains at least one question', () => {
    const result = getMockProtocol('P001');
    expect(result.questions.length).toBeGreaterThan(0);
  });

  it('contains at least one condition', () => {
    const result = getMockProtocol('P001');
    expect(result.conditions.length).toBeGreaterThan(0);
  });

  it('has confidence_score between 0 and 1', () => {
    const result = getMockProtocol('P001');
    expect(result.confidence_score).toBeGreaterThanOrEqual(0);
    expect(result.confidence_score).toBeLessThanOrEqual(1);
  });

  it('protocol_id references the patientId', () => {
    const result = getMockProtocol('P001');
    expect(result.protocol_id).toContain('P001');
  });
});

describe('getMockExtractionResults', () => {
  it('returns an entry for every variable name', () => {
    const result = getMockExtractionResults(['pain', 'fever', 'medication_adherence']);
    expect(Object.keys(result)).toEqual(['pain', 'fever', 'medication_adherence']);
  });

  it('each entry passes ExtractionResultSchema validation', () => {
    const result = getMockExtractionResults(['pain', 'fever']);
    for (const val of Object.values(result)) {
      expect(() => ExtractionResultSchema.parse(val)).not.toThrow();
    }
  });

  it('returns empty object for empty variable names array', () => {
    const result = getMockExtractionResults([]);
    expect(result).toEqual({});
  });

  it('confidence values are between 0 and 1', () => {
    const result = getMockExtractionResults(['x']);
    expect(result['x']!.confidence).toBeGreaterThanOrEqual(0);
    expect(result['x']!.confidence).toBeLessThanOrEqual(1);
  });
});

describe('getMockSummary', () => {
  it('passes IsbarrSchema validation', () => {
    const result = getMockSummary('Jane Doe');
    expect(() => IsbarrSchema.parse(result)).not.toThrow();
  });

  it('identify section references the patient name', () => {
    const result = getMockSummary('Jane Doe');
    expect(result.identify).toContain('Jane Doe');
  });

  it('all I-SBARR fields are non-empty strings', () => {
    const result = getMockSummary('Test Patient');
    expect(result.identify.length).toBeGreaterThan(0);
    expect(result.situation.length).toBeGreaterThan(0);
    expect(result.background.length).toBeGreaterThan(0);
    expect(result.assessment.length).toBeGreaterThan(0);
    expect(result.recommendation.length).toBeGreaterThan(0);
    expect(result.read_back.length).toBeGreaterThan(0);
  });
});

describe('getMockKBResults', () => {
  it('returns at least one result', () => {
    const results = getMockKBResults();
    expect(results.length).toBeGreaterThan(0);
  });

  it('each result passes KBResultSchema validation', () => {
    const results = getMockKBResults();
    for (const r of results) {
      expect(() => KBResultSchema.parse(r)).not.toThrow();
    }
  });

  it('each result has a non-empty content string', () => {
    const results = getMockKBResults();
    for (const r of results) {
      expect(r.content.length).toBeGreaterThan(0);
    }
  });

  it('each score is between 0 and 1', () => {
    const results = getMockKBResults();
    for (const r of results) {
      expect(r.score).toBeGreaterThanOrEqual(0);
      expect(r.score).toBeLessThanOrEqual(1);
    }
  });
});
