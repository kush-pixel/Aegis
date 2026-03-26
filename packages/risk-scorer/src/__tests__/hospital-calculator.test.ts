import { calcHospitalScore } from '../hospital-calculator';

// Baseline all-false input for building on top of
const allFalse = {
  hemoglobin_lt_12: false,
  oncology_patient: false,
  sodium_lt_135: false,
  procedure_during_admission: false,
  index_admission_urgent: false,
  prior_admissions: 0,
  length_of_stay_gte_5: false,
};

describe('calcHospitalScore', () => {
  // ── hemoglobin_lt_12 ────────────────────────────────────────────────────────

  describe('hemoglobin_lt_12 scoring', () => {
    it('returns hemoglobin=1 when hemoglobin_lt_12=true', () => {
      const result = calcHospitalScore({ ...allFalse, hemoglobin_lt_12: true });
      expect(result.hemoglobin).toBe(1);
    });

    it('returns hemoglobin=0 when hemoglobin_lt_12=false', () => {
      const result = calcHospitalScore({ ...allFalse, hemoglobin_lt_12: false });
      expect(result.hemoglobin).toBe(0);
    });
  });

  // ── oncology_patient ────────────────────────────────────────────────────────

  describe('oncology_patient scoring', () => {
    it('returns oncology=2 when oncology_patient=true', () => {
      const result = calcHospitalScore({ ...allFalse, oncology_patient: true });
      expect(result.oncology).toBe(2);
    });

    it('returns oncology=0 when oncology_patient=false', () => {
      const result = calcHospitalScore({ ...allFalse, oncology_patient: false });
      expect(result.oncology).toBe(0);
    });
  });

  // ── sodium_lt_135 ───────────────────────────────────────────────────────────

  describe('sodium_lt_135 scoring', () => {
    it('returns sodium=1 when sodium_lt_135=true', () => {
      const result = calcHospitalScore({ ...allFalse, sodium_lt_135: true });
      expect(result.sodium).toBe(1);
    });

    it('returns sodium=0 when sodium_lt_135=false', () => {
      const result = calcHospitalScore({ ...allFalse, sodium_lt_135: false });
      expect(result.sodium).toBe(0);
    });
  });

  // ── procedure_during_admission ──────────────────────────────────────────────

  describe('procedure_during_admission scoring', () => {
    it('returns procedure=1 when procedure_during_admission=true', () => {
      const result = calcHospitalScore({ ...allFalse, procedure_during_admission: true });
      expect(result.procedure).toBe(1);
    });

    it('returns procedure=0 when procedure_during_admission=false', () => {
      const result = calcHospitalScore({ ...allFalse, procedure_during_admission: false });
      expect(result.procedure).toBe(0);
    });
  });

  // ── index_admission_urgent ──────────────────────────────────────────────────

  describe('index_admission_urgent scoring', () => {
    it('returns index_admission=1 when index_admission_urgent=true', () => {
      const result = calcHospitalScore({ ...allFalse, index_admission_urgent: true });
      expect(result.index_admission).toBe(1);
    });

    it('returns index_admission=0 when index_admission_urgent=false', () => {
      const result = calcHospitalScore({ ...allFalse, index_admission_urgent: false });
      expect(result.index_admission).toBe(0);
    });
  });

  // ── length_of_stay_gte_5 ────────────────────────────────────────────────────

  describe('length_of_stay_gte_5 scoring', () => {
    it('returns ed_visits=2 when length_of_stay_gte_5=true', () => {
      const result = calcHospitalScore({ ...allFalse, length_of_stay_gte_5: true });
      expect(result.ed_visits).toBe(2);
    });

    it('returns ed_visits=0 when length_of_stay_gte_5=false', () => {
      const result = calcHospitalScore({ ...allFalse, length_of_stay_gte_5: false });
      expect(result.ed_visits).toBe(0);
    });
  });

  // ── prior_admissions all three branches ────────────────────────────────────

  describe('prior_admissions scoring (scoreNumAdmissions)', () => {
    it('returns num_admissions=0 when prior_admissions=0', () => {
      const result = calcHospitalScore({ ...allFalse, prior_admissions: 0 });
      expect(result.num_admissions).toBe(0);
    });

    it('returns num_admissions=2 when prior_admissions=1', () => {
      const result = calcHospitalScore({ ...allFalse, prior_admissions: 1 });
      expect(result.num_admissions).toBe(2);
    });

    it('returns num_admissions=2 when prior_admissions=5 (upper edge of middle branch)', () => {
      const result = calcHospitalScore({ ...allFalse, prior_admissions: 5 });
      expect(result.num_admissions).toBe(2);
    });

    it('returns num_admissions=5 when prior_admissions=6', () => {
      const result = calcHospitalScore({ ...allFalse, prior_admissions: 6 });
      expect(result.num_admissions).toBe(5);
    });

    it('returns num_admissions=5 when prior_admissions=10', () => {
      const result = calcHospitalScore({ ...allFalse, prior_admissions: 10 });
      expect(result.num_admissions).toBe(5);
    });
  });

  // ── risk_level boundaries ───────────────────────────────────────────────────

  describe('risk_level boundaries', () => {
    it('returns risk_level=LOW when total=0', () => {
      const result = calcHospitalScore({ ...allFalse });
      expect(result.total).toBe(0);
      expect(result.risk_level).toBe('LOW');
    });

    it('returns risk_level=LOW when total=4', () => {
      // oncology(2) + hemoglobin(1) + sodium(1) = 4
      const result = calcHospitalScore({
        ...allFalse,
        oncology_patient: true,
        hemoglobin_lt_12: true,
        sodium_lt_135: true,
      });
      expect(result.total).toBe(4);
      expect(result.risk_level).toBe('LOW');
    });

    it('returns risk_level=INTERMEDIATE when total=5', () => {
      // oncology(2) + hemoglobin(1) + sodium(1) + procedure(1) = 5
      const result = calcHospitalScore({
        ...allFalse,
        oncology_patient: true,
        hemoglobin_lt_12: true,
        sodium_lt_135: true,
        procedure_during_admission: true,
      });
      expect(result.total).toBe(5);
      expect(result.risk_level).toBe('INTERMEDIATE');
    });

    it('returns risk_level=INTERMEDIATE when total=6', () => {
      // oncology(2) + hemoglobin(1) + sodium(1) + procedure(1) + index_admission(1) = 6
      const result = calcHospitalScore({
        ...allFalse,
        oncology_patient: true,
        hemoglobin_lt_12: true,
        sodium_lt_135: true,
        procedure_during_admission: true,
        index_admission_urgent: true,
      });
      expect(result.total).toBe(6);
      expect(result.risk_level).toBe('INTERMEDIATE');
    });

    it('returns risk_level=HIGH when total=7', () => {
      // oncology(2) + hemoglobin(1) + sodium(1) + procedure(1) + index_admission(1) + los(2) - but that's 8
      // oncology(2) + hemoglobin(1) + sodium(1) + procedure(1) + prior_admissions=1(2) = 7
      const result = calcHospitalScore({
        ...allFalse,
        oncology_patient: true,
        hemoglobin_lt_12: true,
        sodium_lt_135: true,
        procedure_during_admission: true,
        prior_admissions: 1,
      });
      expect(result.total).toBe(7);
      expect(result.risk_level).toBe('HIGH');
    });

    it('returns risk_level=HIGH when total=13 (maximum score)', () => {
      const result = calcHospitalScore({
        hemoglobin_lt_12: true,
        oncology_patient: true,
        sodium_lt_135: true,
        procedure_during_admission: true,
        index_admission_urgent: true,
        prior_admissions: 6,
        length_of_stay_gte_5: true,
      });
      expect(result.total).toBe(13);
      expect(result.risk_level).toBe('HIGH');
    });
  });

  // ── full scenario: all false ────────────────────────────────────────────────

  describe('full scenario: all inputs false / zero', () => {
    it('returns score 0 for every component and total=0, LOW', () => {
      const result = calcHospitalScore({ ...allFalse });
      expect(result).toEqual({
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
    });
  });

  describe('full scenario: all inputs true with 6 prior admissions', () => {
    it('returns maximum total=13 and HIGH', () => {
      const result = calcHospitalScore({
        hemoglobin_lt_12: true,
        oncology_patient: true,
        sodium_lt_135: true,
        procedure_during_admission: true,
        index_admission_urgent: true,
        prior_admissions: 6,
        length_of_stay_gte_5: true,
      });
      expect(result).toEqual({
        hemoglobin: 1,
        oncology: 2,
        sodium: 1,
        procedure: 1,
        index_admission: 1,
        num_admissions: 5,
        ed_visits: 2,
        total: 13,
        risk_level: 'HIGH',
      });
    });
  });

  // ── input validation ────────────────────────────────────────────────────────

  describe('input validation', () => {
    it('throws when prior_admissions is negative', () => {
      expect(() =>
        calcHospitalScore({ ...allFalse, prior_admissions: -1 }),
      ).toThrow();
    });
  });
});
