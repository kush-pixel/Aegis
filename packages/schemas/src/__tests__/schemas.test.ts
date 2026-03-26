import {
  ExtractionResultSchema,
  PatientProfileSchema,
  HospitalScoreSchema,
  CompositeRiskSchema,
  IsbarrSchema,
  SdohScreeningSchema,
  TriageProtocolSchema,
  ClinicalRuleSchema,
  CallResultSchema,
} from '../index';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Asserts that parsing throws a ZodError (or any error). */
const expectInvalid = (fn: () => unknown): void => {
  expect(fn).toThrow();
};

// ---------------------------------------------------------------------------
// Shared fixtures used across multiple schemas
// ---------------------------------------------------------------------------

const validIsbarr = {
  identify: 'Nurse Jane calling about patient',
  situation: 'Patient reports shortness of breath',
  background: 'Discharged 2 days ago after COPD exacerbation',
  assessment: 'Possible decompensation',
  recommendation: 'Immediate physician review required',
  read_back: 'Understood, escalating to on-call',
};

const validSdoh = {
  medication_cost_barrier: false,
  transportation_barrier: true,
  z_codes: ['Z59.4', 'Z87.39'],
};

// ---------------------------------------------------------------------------
// ExtractionResultSchema
// ---------------------------------------------------------------------------

describe('ExtractionResultSchema', () => {
  it('parses valid string value', () => {
    const result = ExtractionResultSchema.parse({
      value: 'yes',
      confidence: 0.9,
      raw_transcript: 'Patient said yes',
    });
    expect(result.value).toBe('yes');
    expect(result.confidence).toBe(0.9);
  });

  it('parses valid number value', () => {
    const result = ExtractionResultSchema.parse({
      value: 3.5,
      confidence: 0.75,
      raw_transcript: 'Patient gained 3.5 pounds',
    });
    expect(result.value).toBe(3.5);
  });

  it('parses valid boolean value', () => {
    const result = ExtractionResultSchema.parse({
      value: true,
      confidence: 1,
      raw_transcript: 'Yes confirmed',
    });
    expect(result.value).toBe(true);
  });

  it('parses confidence at boundary 0', () => {
    const result = ExtractionResultSchema.parse({
      value: 'no',
      confidence: 0,
      raw_transcript: 'uncertain',
    });
    expect(result.confidence).toBe(0);
  });

  it('parses confidence at boundary 1', () => {
    const result = ExtractionResultSchema.parse({
      value: 'yes',
      confidence: 1,
      raw_transcript: 'absolutely yes',
    });
    expect(result.confidence).toBe(1);
  });

  it('rejects confidence > 1', () => {
    expectInvalid(() =>
      ExtractionResultSchema.parse({ value: 'x', confidence: 1.1, raw_transcript: 'x' }),
    );
  });

  it('rejects confidence < 0', () => {
    expectInvalid(() =>
      ExtractionResultSchema.parse({ value: 'x', confidence: -0.01, raw_transcript: 'x' }),
    );
  });

  it('rejects missing raw_transcript', () => {
    expectInvalid(() =>
      ExtractionResultSchema.parse({ value: 'x', confidence: 0.5 }),
    );
  });

  it('rejects missing value field', () => {
    expectInvalid(() =>
      ExtractionResultSchema.parse({ confidence: 0.5, raw_transcript: 'x' }),
    );
  });

  it('rejects null value', () => {
    expectInvalid(() =>
      ExtractionResultSchema.parse({ value: null, confidence: 0.5, raw_transcript: 'x' }),
    );
  });
});

// ---------------------------------------------------------------------------
// PatientProfileSchema
// ---------------------------------------------------------------------------

describe('PatientProfileSchema', () => {
  const validProfile = {
    patient_id: 'PAT-abc123',
    name: 'Jane Doe',
    phone: '+15551234567',
    discharge_date: '2026-03-24',
    conditions: ['CHF', 'COPD'],
    lace_score: 10,
    hospital_score: 7,
    composite_risk_score: 72.5,
    risk_level: 'HIGH' as const,
  };

  it('parses a fully valid patient profile', () => {
    const result = PatientProfileSchema.parse(validProfile);
    expect(result.patient_id).toBe('PAT-abc123');
    expect(result.risk_level).toBe('HIGH');
  });

  it('parses all four risk_level values', () => {
    for (const level of ['LOW', 'MODERATE', 'HIGH', 'VERY_HIGH'] as const) {
      const result = PatientProfileSchema.parse({ ...validProfile, risk_level: level });
      expect(result.risk_level).toBe(level);
    }
  });

  it('parses empty conditions array', () => {
    const result = PatientProfileSchema.parse({ ...validProfile, conditions: [] });
    expect(result.conditions).toHaveLength(0);
  });

  it('rejects empty patient_id string', () => {
    expectInvalid(() => PatientProfileSchema.parse({ ...validProfile, patient_id: '' }));
  });

  it('rejects empty name string', () => {
    expectInvalid(() => PatientProfileSchema.parse({ ...validProfile, name: '' }));
  });

  it('rejects lace_score above 19', () => {
    expectInvalid(() => PatientProfileSchema.parse({ ...validProfile, lace_score: 20 }));
  });

  it('rejects lace_score below 0', () => {
    expectInvalid(() => PatientProfileSchema.parse({ ...validProfile, lace_score: -1 }));
  });

  it('rejects lace_score as float', () => {
    expectInvalid(() => PatientProfileSchema.parse({ ...validProfile, lace_score: 5.5 }));
  });

  it('rejects hospital_score above 13', () => {
    expectInvalid(() => PatientProfileSchema.parse({ ...validProfile, hospital_score: 14 }));
  });

  it('rejects composite_risk_score above 100', () => {
    expectInvalid(() =>
      PatientProfileSchema.parse({ ...validProfile, composite_risk_score: 100.1 }),
    );
  });

  it('rejects invalid risk_level enum value', () => {
    expectInvalid(() => PatientProfileSchema.parse({ ...validProfile, risk_level: 'CRITICAL' }));
  });

  it('rejects missing phone field', () => {
    const { phone: _phone, ...rest } = validProfile;
    expectInvalid(() => PatientProfileSchema.parse(rest));
  });
});

// ---------------------------------------------------------------------------
// HospitalScoreSchema
// ---------------------------------------------------------------------------

describe('HospitalScoreSchema', () => {
  const validHospital = {
    hemoglobin: 1 as const,
    oncology: 2 as const,
    sodium: 0 as const,
    procedure: 1 as const,
    index_admission: 0 as const,
    num_admissions: 3,
    ed_visits: 2 as const,
    total: 9,
    risk_level: 'HIGH' as const,
  };

  it('parses a fully valid hospital score', () => {
    const result = HospitalScoreSchema.parse(validHospital);
    expect(result.total).toBe(9);
    expect(result.risk_level).toBe('HIGH');
  });

  it('parses minimum boundary values', () => {
    const result = HospitalScoreSchema.parse({
      hemoglobin: 0,
      oncology: 0,
      sodium: 0,
      procedure: 0,
      index_admission: 0,
      num_admissions: 0,
      ed_visits: 0,
      total: 0,
      risk_level: 'LOW',
    });
    expect(result.total).toBe(0);
  });

  it('parses all three risk_level values', () => {
    for (const level of ['LOW', 'INTERMEDIATE', 'HIGH'] as const) {
      const result = HospitalScoreSchema.parse({ ...validHospital, risk_level: level });
      expect(result.risk_level).toBe(level);
    }
  });

  it('rejects hemoglobin value other than 0 or 1', () => {
    expectInvalid(() => HospitalScoreSchema.parse({ ...validHospital, hemoglobin: 3 }));
  });

  it('rejects oncology value other than 0 or 2', () => {
    expectInvalid(() => HospitalScoreSchema.parse({ ...validHospital, oncology: 1 }));
  });

  it('rejects ed_visits value other than 0, 1, or 2', () => {
    expectInvalid(() => HospitalScoreSchema.parse({ ...validHospital, ed_visits: 3 }));
  });

  it('rejects num_admissions above 5', () => {
    expectInvalid(() => HospitalScoreSchema.parse({ ...validHospital, num_admissions: 6 }));
  });

  it('rejects total above 13', () => {
    expectInvalid(() => HospitalScoreSchema.parse({ ...validHospital, total: 14 }));
  });

  it('rejects invalid risk_level — VERY_HIGH is not allowed', () => {
    expectInvalid(() => HospitalScoreSchema.parse({ ...validHospital, risk_level: 'VERY_HIGH' }));
  });

  it('rejects non-integer num_admissions', () => {
    expectInvalid(() => HospitalScoreSchema.parse({ ...validHospital, num_admissions: 2.5 }));
  });
});

// ---------------------------------------------------------------------------
// CompositeRiskSchema
// ---------------------------------------------------------------------------

describe('CompositeRiskSchema', () => {
  const validComposite = {
    lace_score: 12,
    lace_risk_level: 'HIGH' as const,
    hospital_score: 8,
    hospital_risk_level: 'INTERMEDIATE' as const,
    composite_score: 85.0,
    risk_level: 'VERY_HIGH' as const,
  };

  it('parses a fully valid composite risk object', () => {
    const result = CompositeRiskSchema.parse(validComposite);
    expect(result.composite_score).toBe(85.0);
    expect(result.risk_level).toBe('VERY_HIGH');
  });

  it('parses boundary lace_score of 0 and 19', () => {
    CompositeRiskSchema.parse({ ...validComposite, lace_score: 0 });
    CompositeRiskSchema.parse({ ...validComposite, lace_score: 19 });
  });

  it('parses boundary hospital_score of 0 and 13', () => {
    CompositeRiskSchema.parse({ ...validComposite, hospital_score: 0 });
    CompositeRiskSchema.parse({ ...validComposite, hospital_score: 13 });
  });

  it('parses boundary composite_score of 0 and 100', () => {
    CompositeRiskSchema.parse({ ...validComposite, composite_score: 0 });
    CompositeRiskSchema.parse({ ...validComposite, composite_score: 100 });
  });

  it('rejects lace_score above 19', () => {
    expectInvalid(() => CompositeRiskSchema.parse({ ...validComposite, lace_score: 20 }));
  });

  it('rejects lace_risk_level with invalid enum — VERY_HIGH not allowed', () => {
    expectInvalid(() =>
      CompositeRiskSchema.parse({ ...validComposite, lace_risk_level: 'VERY_HIGH' }),
    );
  });

  it('rejects hospital_risk_level with invalid enum — MODERATE not allowed', () => {
    expectInvalid(() =>
      CompositeRiskSchema.parse({ ...validComposite, hospital_risk_level: 'MODERATE' }),
    );
  });

  it('rejects composite_score above 100', () => {
    expectInvalid(() => CompositeRiskSchema.parse({ ...validComposite, composite_score: 100.1 }));
  });

  it('rejects non-integer lace_score', () => {
    expectInvalid(() => CompositeRiskSchema.parse({ ...validComposite, lace_score: 5.5 }));
  });
});

// ---------------------------------------------------------------------------
// IsbarrSchema
// ---------------------------------------------------------------------------

describe('IsbarrSchema', () => {
  it('parses a fully valid I-SBARR object', () => {
    const result = IsbarrSchema.parse(validIsbarr);
    expect(result.identify).toBe(validIsbarr.identify);
    expect(result.read_back).toBe(validIsbarr.read_back);
  });

  it('rejects empty identify string', () => {
    expectInvalid(() => IsbarrSchema.parse({ ...validIsbarr, identify: '' }));
  });

  it('rejects empty situation string', () => {
    expectInvalid(() => IsbarrSchema.parse({ ...validIsbarr, situation: '' }));
  });

  it('rejects empty background string', () => {
    expectInvalid(() => IsbarrSchema.parse({ ...validIsbarr, background: '' }));
  });

  it('rejects empty assessment string', () => {
    expectInvalid(() => IsbarrSchema.parse({ ...validIsbarr, assessment: '' }));
  });

  it('rejects empty recommendation string', () => {
    expectInvalid(() => IsbarrSchema.parse({ ...validIsbarr, recommendation: '' }));
  });

  it('rejects empty read_back string', () => {
    expectInvalid(() => IsbarrSchema.parse({ ...validIsbarr, read_back: '' }));
  });

  it('rejects missing assessment field', () => {
    const { assessment: _a, ...rest } = validIsbarr;
    expectInvalid(() => IsbarrSchema.parse(rest));
  });
});

// ---------------------------------------------------------------------------
// SdohScreeningSchema
// ---------------------------------------------------------------------------

describe('SdohScreeningSchema', () => {
  it('parses valid SDOH screening with barriers present', () => {
    const result = SdohScreeningSchema.parse(validSdoh);
    expect(result.medication_cost_barrier).toBe(false);
    expect(result.transportation_barrier).toBe(true);
    expect(result.z_codes).toEqual(['Z59.4', 'Z87.39']);
  });

  it('parses valid SDOH screening with no barriers and empty z_codes', () => {
    const result = SdohScreeningSchema.parse({
      medication_cost_barrier: false,
      transportation_barrier: false,
      z_codes: [],
    });
    expect(result.z_codes).toHaveLength(0);
  });

  it('rejects non-boolean medication_cost_barrier', () => {
    expectInvalid(() =>
      SdohScreeningSchema.parse({ ...validSdoh, medication_cost_barrier: 'yes' }),
    );
  });

  it('rejects non-boolean transportation_barrier', () => {
    expectInvalid(() =>
      SdohScreeningSchema.parse({ ...validSdoh, transportation_barrier: 1 }),
    );
  });

  it('rejects z_codes as a string instead of array', () => {
    expectInvalid(() => SdohScreeningSchema.parse({ ...validSdoh, z_codes: 'Z59.4' }));
  });

  it('rejects missing transportation_barrier', () => {
    const { transportation_barrier: _tb, ...rest } = validSdoh;
    expectInvalid(() => SdohScreeningSchema.parse(rest));
  });
});

// ---------------------------------------------------------------------------
// TriageProtocolSchema
// ---------------------------------------------------------------------------

describe('TriageProtocolSchema', () => {
  const validQuestion = {
    question_id: 'q1',
    text: 'Have you gained 3 or more pounds since discharge?',
    variable_name: 'weight_gain',
    required: true,
    order: 0,
  };

  const validCondition = {
    condition_code: 'CHF',
    description: 'Congestive Heart Failure',
  };

  const validProtocol = {
    protocol_id: 'proto-001',
    patient_id: 'PAT-xyz',
    questions: [validQuestion],
    conditions: [validCondition],
    confidence_score: 0.92,
    created_at: '2026-03-24T10:00:00Z',
  };

  it('parses a fully valid triage protocol', () => {
    const result = TriageProtocolSchema.parse(validProtocol);
    expect(result.protocol_id).toBe('proto-001');
    expect(result.questions).toHaveLength(1);
    expect(result.questions[0].variable_name).toBe('weight_gain');
  });

  it('parses protocol with empty questions and conditions arrays', () => {
    const result = TriageProtocolSchema.parse({
      ...validProtocol,
      questions: [],
      conditions: [],
    });
    expect(result.questions).toHaveLength(0);
  });

  it('parses protocol with multiple questions in order', () => {
    const q2 = { ...validQuestion, question_id: 'q2', variable_name: 'edema', order: 1 };
    const result = TriageProtocolSchema.parse({ ...validProtocol, questions: [validQuestion, q2] });
    expect(result.questions).toHaveLength(2);
    expect(result.questions[1].order).toBe(1);
  });

  it('parses confidence_score at boundaries 0 and 1', () => {
    TriageProtocolSchema.parse({ ...validProtocol, confidence_score: 0 });
    TriageProtocolSchema.parse({ ...validProtocol, confidence_score: 1 });
  });

  it('rejects empty protocol_id string', () => {
    expectInvalid(() => TriageProtocolSchema.parse({ ...validProtocol, protocol_id: '' }));
  });

  it('rejects empty patient_id string', () => {
    expectInvalid(() => TriageProtocolSchema.parse({ ...validProtocol, patient_id: '' }));
  });

  it('rejects confidence_score above 1', () => {
    expectInvalid(() => TriageProtocolSchema.parse({ ...validProtocol, confidence_score: 1.01 }));
  });

  it('rejects confidence_score below 0', () => {
    expectInvalid(() => TriageProtocolSchema.parse({ ...validProtocol, confidence_score: -0.1 }));
  });

  it('rejects question with empty variable_name', () => {
    const badQ = { ...validQuestion, variable_name: '' };
    expectInvalid(() =>
      TriageProtocolSchema.parse({ ...validProtocol, questions: [badQ] }),
    );
  });

  it('rejects question with negative order', () => {
    const badQ = { ...validQuestion, order: -1 };
    expectInvalid(() =>
      TriageProtocolSchema.parse({ ...validProtocol, questions: [badQ] }),
    );
  });

  it('rejects question with float order', () => {
    const badQ = { ...validQuestion, order: 1.5 };
    expectInvalid(() =>
      TriageProtocolSchema.parse({ ...validProtocol, questions: [badQ] }),
    );
  });

  it('rejects condition with empty condition_code', () => {
    const badCond = { ...validCondition, condition_code: '' };
    expectInvalid(() =>
      TriageProtocolSchema.parse({ ...validProtocol, conditions: [badCond] }),
    );
  });

  it('rejects missing created_at field', () => {
    const { created_at: _ca, ...rest } = validProtocol;
    expectInvalid(() => TriageProtocolSchema.parse(rest));
  });
});

// ---------------------------------------------------------------------------
// ClinicalRuleSchema
// ---------------------------------------------------------------------------

describe('ClinicalRuleSchema', () => {
  const validRuleCondition = {
    variable_name: 'weight_gain',
    operator: 'gte' as const,
    value: 3,
    weight: 0.8,
  };

  const validRule = {
    rule_id: 'rule-chf-001',
    condition_code: 'CHF',
    version_id: 'v1',
    logic: 'AND' as const,
    conditions: [validRuleCondition],
  };

  it('parses a fully valid AND rule with numeric value', () => {
    const result = ClinicalRuleSchema.parse(validRule);
    expect(result.rule_id).toBe('rule-chf-001');
    expect(result.logic).toBe('AND');
  });

  it('parses OR logic rule', () => {
    const result = ClinicalRuleSchema.parse({ ...validRule, logic: 'OR' });
    expect(result.logic).toBe('OR');
  });

  it('parses WEIGHTED logic rule with weighted_threshold', () => {
    const result = ClinicalRuleSchema.parse({
      ...validRule,
      logic: 'WEIGHTED',
      weighted_threshold: 0.6,
    });
    expect(result.weighted_threshold).toBe(0.6);
  });

  it('parses rule condition with boolean value', () => {
    const boolCondition = { ...validRuleCondition, value: true, operator: 'eq' as const };
    const result = ClinicalRuleSchema.parse({ ...validRule, conditions: [boolCondition] });
    expect(result.conditions[0].value).toBe(true);
  });

  it('parses rule condition with string value', () => {
    const strCondition = { ...validRuleCondition, value: 'yes', operator: 'contains' as const };
    const result = ClinicalRuleSchema.parse({ ...validRule, conditions: [strCondition] });
    expect(result.conditions[0].value).toBe('yes');
  });

  it('parses rule condition without optional weight field', () => {
    const { weight: _w, ...noWeight } = validRuleCondition;
    const result = ClinicalRuleSchema.parse({ ...validRule, conditions: [noWeight] });
    expect(result.conditions[0].weight).toBeUndefined();
  });

  it('parses all six operator values', () => {
    const operators = ['eq', 'gt', 'lt', 'gte', 'lte', 'contains'] as const;
    for (const op of operators) {
      const result = ClinicalRuleSchema.parse({
        ...validRule,
        conditions: [{ ...validRuleCondition, operator: op }],
      });
      expect(result.conditions[0].operator).toBe(op);
    }
  });

  it('rejects empty conditions array', () => {
    expectInvalid(() => ClinicalRuleSchema.parse({ ...validRule, conditions: [] }));
  });

  it('rejects invalid logic value', () => {
    expectInvalid(() => ClinicalRuleSchema.parse({ ...validRule, logic: 'NONE' }));
  });

  it('rejects invalid operator value', () => {
    const badCond = { ...validRuleCondition, operator: 'ne' };
    expectInvalid(() => ClinicalRuleSchema.parse({ ...validRule, conditions: [badCond] }));
  });

  it('rejects weighted_threshold above 1', () => {
    expectInvalid(() =>
      ClinicalRuleSchema.parse({ ...validRule, weighted_threshold: 1.01 }),
    );
  });

  it('rejects weighted_threshold below 0', () => {
    expectInvalid(() =>
      ClinicalRuleSchema.parse({ ...validRule, weighted_threshold: -0.1 }),
    );
  });

  it('rejects empty rule_id string', () => {
    expectInvalid(() => ClinicalRuleSchema.parse({ ...validRule, rule_id: '' }));
  });

  it('rejects empty condition_code string', () => {
    expectInvalid(() => ClinicalRuleSchema.parse({ ...validRule, condition_code: '' }));
  });

  it('rejects empty variable_name in rule condition', () => {
    const badCond = { ...validRuleCondition, variable_name: '' };
    expectInvalid(() => ClinicalRuleSchema.parse({ ...validRule, conditions: [badCond] }));
  });
});

// ---------------------------------------------------------------------------
// CallResultSchema
// ---------------------------------------------------------------------------

describe('CallResultSchema', () => {
  const validCallResult = {
    call_id: 'call-abc-001',
    patient_id: 'PAT-xyz',
    variables: {
      weight_gain: { value: 4, confidence: 0.95, raw_transcript: 'I gained about four pounds' },
      edema: { value: true, confidence: 0.88, raw_transcript: 'Yes my ankles are swollen' },
    },
    sdoh_responses: validSdoh,
    triage_status: 'RED' as const,
    isbarr_summary: validIsbarr,
    created_at: '2026-03-26T08:00:00Z',
  };

  it('parses a fully valid call result with RED triage status', () => {
    const result = CallResultSchema.parse(validCallResult);
    expect(result.call_id).toBe('call-abc-001');
    expect(result.triage_status).toBe('RED');
    expect(result.variables['weight_gain'].value).toBe(4);
  });

  it('parses all four triage_status values', () => {
    for (const status of ['RED', 'YELLOW', 'GREEN', 'INCOMPLETE'] as const) {
      const result = CallResultSchema.parse({ ...validCallResult, triage_status: status });
      expect(result.triage_status).toBe(status);
    }
  });

  it('parses call result with empty variables record', () => {
    const result = CallResultSchema.parse({ ...validCallResult, variables: {} });
    expect(result.variables).toEqual({});
  });

  it('parses call result with string extraction value in variables', () => {
    const result = CallResultSchema.parse({
      ...validCallResult,
      variables: {
        shortness_of_breath: { value: 'yes', confidence: 0.9, raw_transcript: 'yes I have trouble breathing' },
      },
    });
    expect(result.variables['shortness_of_breath'].value).toBe('yes');
  });

  it('rejects empty call_id string', () => {
    expectInvalid(() => CallResultSchema.parse({ ...validCallResult, call_id: '' }));
  });

  it('rejects empty patient_id string', () => {
    expectInvalid(() => CallResultSchema.parse({ ...validCallResult, patient_id: '' }));
  });

  it('rejects invalid triage_status', () => {
    expectInvalid(() => CallResultSchema.parse({ ...validCallResult, triage_status: 'BLUE' }));
  });

  it('rejects variable entry with out-of-range confidence', () => {
    expectInvalid(() =>
      CallResultSchema.parse({
        ...validCallResult,
        variables: {
          weight_gain: { value: 3, confidence: 2.0, raw_transcript: 'gained weight' },
        },
      }),
    );
  });

  it('rejects invalid sdoh_responses — non-boolean barrier', () => {
    expectInvalid(() =>
      CallResultSchema.parse({
        ...validCallResult,
        sdoh_responses: { ...validSdoh, medication_cost_barrier: 'yes' },
      }),
    );
  });

  it('rejects invalid isbarr_summary — empty assess field', () => {
    expectInvalid(() =>
      CallResultSchema.parse({
        ...validCallResult,
        isbarr_summary: { ...validIsbarr, assessment: '' },
      }),
    );
  });

  it('rejects missing created_at field', () => {
    const { created_at: _ca, ...rest } = validCallResult;
    expectInvalid(() => CallResultSchema.parse(rest));
  });
});
