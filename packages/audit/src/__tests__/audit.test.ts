import { auditLog, AuditContext } from '../audit-log';

describe('auditLog', () => {
  let consoleSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  // ---------------------------------------------------------------------------
  // Output routing
  // ---------------------------------------------------------------------------

  it('writes exactly one line to console.log', () => {
    const ctx: AuditContext = { action: 'LOGIN', actor: 'nurse-01', resource: 'patient/123' };
    auditLog(ctx);
    expect(consoleSpy).toHaveBeenCalledTimes(1);
  });

  // ---------------------------------------------------------------------------
  // [AUDIT] prefix
  // ---------------------------------------------------------------------------

  it('output starts with "[AUDIT] "', () => {
    const ctx: AuditContext = { action: 'VIEW', actor: 'doc-02', resource: 'encounter/456' };
    auditLog(ctx);
    const output: string = consoleSpy.mock.calls[0][0] as string;
    expect(output).toMatch(/^\[AUDIT\] /);
  });

  // ---------------------------------------------------------------------------
  // Valid JSON after prefix
  // ---------------------------------------------------------------------------

  it('output contains valid JSON after the "[AUDIT] " prefix', () => {
    const ctx: AuditContext = { action: 'CREATE', actor: 'system', resource: 'call/789' };
    auditLog(ctx);
    const raw: string = consoleSpy.mock.calls[0][0] as string;
    const jsonPart = raw.slice('[AUDIT] '.length);
    expect(() => JSON.parse(jsonPart)).not.toThrow();
  });

  // ---------------------------------------------------------------------------
  // Required fields in JSON
  // ---------------------------------------------------------------------------

  it('JSON contains the action field matching the input', () => {
    const ctx: AuditContext = { action: 'DISCHARGE', actor: 'nurse-03', resource: 'patient/321' };
    auditLog(ctx);
    const raw: string = consoleSpy.mock.calls[0][0] as string;
    const parsed = JSON.parse(raw.slice('[AUDIT] '.length)) as Record<string, unknown>;
    expect(parsed.action).toBe('DISCHARGE');
  });

  it('JSON contains the actor field matching the input', () => {
    const ctx: AuditContext = { action: 'UPDATE', actor: 'admin-99', resource: 'protocol/007' };
    auditLog(ctx);
    const raw: string = consoleSpy.mock.calls[0][0] as string;
    const parsed = JSON.parse(raw.slice('[AUDIT] '.length)) as Record<string, unknown>;
    expect(parsed.actor).toBe('admin-99');
  });

  it('JSON contains the resource field matching the input', () => {
    const ctx: AuditContext = { action: 'READ', actor: 'nurse-05', resource: 'observation/555' };
    auditLog(ctx);
    const raw: string = consoleSpy.mock.calls[0][0] as string;
    const parsed = JSON.parse(raw.slice('[AUDIT] '.length)) as Record<string, unknown>;
    expect(parsed.resource).toBe('observation/555');
  });

  it('JSON contains a timestamp field', () => {
    const ctx: AuditContext = { action: 'DELETE', actor: 'admin-01', resource: 'rule/42' };
    auditLog(ctx);
    const raw: string = consoleSpy.mock.calls[0][0] as string;
    const parsed = JSON.parse(raw.slice('[AUDIT] '.length)) as Record<string, unknown>;
    expect(parsed).toHaveProperty('timestamp');
  });

  // ---------------------------------------------------------------------------
  // Timestamp is valid ISO 8601
  // ---------------------------------------------------------------------------

  it('timestamp is a valid ISO 8601 string', () => {
    const before = Date.now();
    const ctx: AuditContext = { action: 'CALL_START', actor: 'system', resource: 'call/001' };
    auditLog(ctx);
    const after = Date.now();
    const raw: string = consoleSpy.mock.calls[0][0] as string;
    const parsed = JSON.parse(raw.slice('[AUDIT] '.length)) as Record<string, unknown>;
    const ts = parsed.timestamp as string;
    // Must parse to a real date
    const ms = Date.parse(ts);
    expect(Number.isNaN(ms)).toBe(false);
    // Must be in the valid time window for this test run
    expect(ms).toBeGreaterThanOrEqual(before);
    expect(ms).toBeLessThanOrEqual(after);
    // Must match ISO 8601 format produced by toISOString()
    expect(ts).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  // ---------------------------------------------------------------------------
  // Optional field — callId present
  // ---------------------------------------------------------------------------

  it('JSON contains callId when it is provided', () => {
    const ctx: AuditContext = {
      action: 'TRIAGE',
      actor: 'engine',
      resource: 'patient/777',
      callId: 'call-abc-123',
    };
    auditLog(ctx);
    const raw: string = consoleSpy.mock.calls[0][0] as string;
    const parsed = JSON.parse(raw.slice('[AUDIT] '.length)) as Record<string, unknown>;
    expect(parsed.callId).toBe('call-abc-123');
  });

  // ---------------------------------------------------------------------------
  // Optional field — callId absent
  // ---------------------------------------------------------------------------

  it('JSON does NOT contain callId when it is omitted', () => {
    const ctx: AuditContext = { action: 'VIEW', actor: 'nurse-07', resource: 'patient/888' };
    auditLog(ctx);
    const raw: string = consoleSpy.mock.calls[0][0] as string;
    const parsed = JSON.parse(raw.slice('[AUDIT] '.length)) as Record<string, unknown>;
    expect(Object.prototype.hasOwnProperty.call(parsed, 'callId')).toBe(false);
  });

  it('JSON does NOT contain callId when it is explicitly undefined', () => {
    const ctx: AuditContext = {
      action: 'VIEW',
      actor: 'nurse-08',
      resource: 'patient/999',
      callId: undefined,
    };
    auditLog(ctx);
    const raw: string = consoleSpy.mock.calls[0][0] as string;
    const parsed = JSON.parse(raw.slice('[AUDIT] '.length)) as Record<string, unknown>;
    expect(Object.prototype.hasOwnProperty.call(parsed, 'callId')).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // Optional field — detail present
  // ---------------------------------------------------------------------------

  it('JSON contains detail when it is provided', () => {
    const ctx: AuditContext = {
      action: 'FLAG',
      actor: 'engine',
      resource: 'call/002',
      detail: 'weight gain >= 3 lbs',
    };
    auditLog(ctx);
    const raw: string = consoleSpy.mock.calls[0][0] as string;
    const parsed = JSON.parse(raw.slice('[AUDIT] '.length)) as Record<string, unknown>;
    expect(parsed.detail).toBe('weight gain >= 3 lbs');
  });

  // ---------------------------------------------------------------------------
  // Optional field — detail absent
  // ---------------------------------------------------------------------------

  it('JSON does NOT contain detail when it is omitted', () => {
    const ctx: AuditContext = { action: 'CLOSE', actor: 'system', resource: 'call/003' };
    auditLog(ctx);
    const raw: string = consoleSpy.mock.calls[0][0] as string;
    const parsed = JSON.parse(raw.slice('[AUDIT] '.length)) as Record<string, unknown>;
    expect(Object.prototype.hasOwnProperty.call(parsed, 'detail')).toBe(false);
  });

  it('JSON does NOT contain detail when it is explicitly undefined', () => {
    const ctx: AuditContext = {
      action: 'CLOSE',
      actor: 'system',
      resource: 'call/004',
      detail: undefined,
    };
    auditLog(ctx);
    const raw: string = consoleSpy.mock.calls[0][0] as string;
    const parsed = JSON.parse(raw.slice('[AUDIT] '.length)) as Record<string, unknown>;
    expect(Object.prototype.hasOwnProperty.call(parsed, 'detail')).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // Both optional fields present together
  // ---------------------------------------------------------------------------

  it('JSON contains both callId and detail when both are provided', () => {
    const ctx: AuditContext = {
      action: 'ESCALATE',
      actor: 'triage-engine',
      resource: 'patient/101',
      callId: 'call-xyz-999',
      detail: 'RED — dyspnea reported',
    };
    auditLog(ctx);
    const raw: string = consoleSpy.mock.calls[0][0] as string;
    const parsed = JSON.parse(raw.slice('[AUDIT] '.length)) as Record<string, unknown>;
    expect(parsed.callId).toBe('call-xyz-999');
    expect(parsed.detail).toBe('RED — dyspnea reported');
  });

  // ---------------------------------------------------------------------------
  // JSON contains exactly the expected keys (no extras, no surprises)
  // ---------------------------------------------------------------------------

  it('JSON has exactly [timestamp, action, actor, resource] when no optional fields are given', () => {
    const ctx: AuditContext = { action: 'PING', actor: 'health-check', resource: 'system' };
    auditLog(ctx);
    const raw: string = consoleSpy.mock.calls[0][0] as string;
    const parsed = JSON.parse(raw.slice('[AUDIT] '.length)) as Record<string, unknown>;
    expect(Object.keys(parsed).sort()).toEqual(['action', 'actor', 'resource', 'timestamp']);
  });

  it('JSON has exactly [timestamp, action, actor, resource, callId, detail] when both optional fields are given', () => {
    const ctx: AuditContext = {
      action: 'AUDIT_ALL',
      actor: 'admin',
      resource: 'system',
      callId: 'c-1',
      detail: 'full context',
    };
    auditLog(ctx);
    const raw: string = consoleSpy.mock.calls[0][0] as string;
    const parsed = JSON.parse(raw.slice('[AUDIT] '.length)) as Record<string, unknown>;
    expect(Object.keys(parsed).sort()).toEqual([
      'action',
      'actor',
      'callId',
      'detail',
      'resource',
      'timestamp',
    ]);
  });
});
