"use client";

import React, { useState } from 'react';
import { RealtimeProvider, useRealtimeState } from '../components/RealtimeProvider';
import TriageCard from '../components/TriageCard';
import RiskScoreCard from '../components/RiskScoreCard';
import IsbarrModal from '../components/IsbarrModal';
import ProtocolReview from '../components/ProtocolReview';
import LoginPage from '../components/LoginPage';
import { 
  PatientProfile, 
  CallResult,
  Isbarr,
  LaceScore,
  HospitalScore,
  ProtocolReview as ProtocolReviewType,
  SdohScreening
} from '@aegis/schemas';

// Mock Data
const mockPatients: PatientProfile[] = [
  {
    patient_id: '1',
    name: 'John Doe',
    phone: '555-555-5555',
    discharge_date: '2026-03-25T00:00:00.000Z',
    conditions: ['I50.9'],
    lace_score: 14,
    hospital_score: 11,
    composite_risk_score: 95,
    risk_level: 'HIGH',
  },
  {
    patient_id: '2',
    name: 'Jane Smith',
    phone: '555-555-5556',
    discharge_date: '2026-03-23T00:00:00.000Z',
    conditions: ['J44.1'],
    lace_score: 7,
    hospital_score: 4,
    composite_risk_score: 60,
    risk_level: 'MODERATE',
  },
  {
    patient_id: '3',
    name: 'Emily Johnson',
    phone: '555-555-5557',
    discharge_date: '2026-03-24T00:00:00.000Z',
    conditions: ['E11.9'],
    lace_score: 1,
    hospital_score: 1,
    composite_risk_score: 20,
    risk_level: 'LOW',
  },
];

const mockIsbarr: Isbarr = {
  identify: 'John Doe, 68M',
  situation: 'Patient reports weight gain of 4 lbs since yesterday and increasing shortness of breath at rest.',
  background: 'Discharged 3 days ago following acute decompensated heart failure. On Lasix 40mg daily and Lisinopril.',
  assessment: 'Weight gain exceeds 3 lb threshold. Shortness of breath at rest indicates possible fluid overload. HIGH composite risk.',
  recommendation: 'Urgent clinical review required within 2 hours. Contact on-call cardiologist. Consider same-day ED evaluation.',
  read_back: 'Understood. Calling on-call cardiologist now and advising patient to go to ED if symptoms worsen before callback.',
};

const mockCallResults: CallResult[] = [
    {
        call_id: 'call1',
        patient_id: '1',
        variables: {},
        sdoh_responses: { medication_cost_barrier: true, transportation_barrier: false, z_codes: [] },
        triage_status: 'RED',
        isbarr_summary: mockIsbarr,
        created_at: '2026-03-25T00:00:00.000Z',
        broken_rules: ['Weight Gain Threshold', 'Dyspnea at Rest'],
    },
    {
        call_id: 'call2',
        patient_id: '2',
        variables: {},
        sdoh_responses: { medication_cost_barrier: false, transportation_barrier: true, z_codes: [] },
        triage_status: 'YELLOW',
        isbarr_summary: {
            identify: 'Jane Smith, 72F',
            situation: 'Patient reports using rescue inhaler 3 times today and feels more breathless than yesterday.',
            background: 'Discharged 5 days ago following COPD exacerbation. On Spiriva and Prednisone taper.',
            assessment: 'Increased rescue inhaler use above threshold. Symptom progression noted. MODERATE composite risk.',
            recommendation: 'Nurse callback within 24 hours. Confirm Prednisone taper adherence. Advise patient to call 911 if breathlessness worsens overnight.',
            read_back: 'Understood. Will call patient tomorrow morning and have advised patient on when to call emergency services.',
        },
        created_at: '2026-03-23T00:00:00.000Z',
    },
    {
        call_id: 'call3',
        patient_id: '3',
        variables: {},
        sdoh_responses: { medication_cost_barrier: false, transportation_barrier: false, z_codes: [] },
        triage_status: 'GREEN',
        isbarr_summary: {
            identify: 'Emily Johnson, 55F',
            situation: 'Patient reports feeling well, taking all medications as prescribed, blood sugar readings in normal range.',
            background: 'Discharged 4 days ago following diabetic ketoacidosis episode. On insulin glargine and metformin.',
            assessment: 'No concerning symptoms reported. Medication adherence confirmed. Blood glucose within target range. LOW composite risk.',
            recommendation: 'Patient recovering as expected. Continue current insulin regimen. Schedule routine 7-day follow-up call.',
            read_back: 'Understood. Continuing medications as prescribed and will call back if blood sugar goes above 250 or below 70.',
        },
        created_at: '2026-03-24T00:00:00.000Z',
    }
];

const mockLaceScores: Record<string, LaceScore> = {
    '1': { length_of_stay: 7, acuity: 3, comorbidity: 5, ed_visits: 4, total: 19, risk_level: 'HIGH' },
    '2': { length_of_stay: 3, acuity: 0, comorbidity: 2, ed_visits: 1, total: 6, risk_level: 'MODERATE' },
    '3': { length_of_stay: 1, acuity: 0, comorbidity: 0, ed_visits: 0, total: 1, risk_level: 'LOW' }
};

const mockHospitalScores: Record<string, HospitalScore> = {
    '1': { hemoglobin: 1, oncology: 2, sodium: 1, procedure: 1, index_admission: 1, num_admissions: 5, ed_visits: 2, total: 13, risk_level: 'HIGH' },
    '2': { hemoglobin: 0, oncology: 0, sodium: 1, procedure: 0, index_admission: 0, num_admissions: 1, ed_visits: 1, total: 3, risk_level: 'LOW' },
    '3': { hemoglobin: 0, oncology: 0, sodium: 0, procedure: 1, index_admission: 0, num_admissions: 0, ed_visits: 0, total: 1, risk_level: 'LOW' },
};

const mockProtocolReview: ProtocolReviewType = {
    review_id: 'pr1',
    patient_id: '1',
    protocol_id: 'sepsis-v1',
    status: 'PENDING',
    confidence_score: 0.95,
    created_at: '2024-01-15T01:00:00.000Z'
};


const Dashboard = () => {
  const [selectedPatientId, setSelectedPatientId] = useState<string>('1');
  const [isModalOpen, setIsModalOpen] = useState(false);

  const selectedPatient = mockPatients.find(p => p.patient_id === selectedPatientId);
  const selectedCallResult = mockCallResults.find(cr => cr.patient_id === selectedPatientId);
  const selectedLaceScore = selectedPatient ? mockLaceScores[selectedPatient.patient_id] : undefined;
  const selectedHospitalScore = selectedPatient ? mockHospitalScores[selectedPatient.patient_id] : undefined;

  const handleCardClick = (patientId: string) => {
    setSelectedPatientId(patientId);
  };
  
  const handleViewIsbarr = () => {
    if (selectedCallResult?.isbarr_summary) {
      setIsModalOpen(true);
    }
  };

  const handleApprove = (reviewId: string) => {
    void reviewId;
  };

  const handleReject = (reviewId: string) => {
    void reviewId;
  };

  return (
    <main className="bg-gray-950 text-gray-100 min-h-screen p-4 md:p-8">
      <header className="mb-8">
        <h1 className="text-4xl font-bold font-sans">Nurse Triage Dashboard</h1>
        <p className="text-gray-400 font-sans">Real-time patient monitoring and triage</p>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-3 xl:col-cols-4 gap-6">
        <div className="md:col-span-2 xl:col-span-3 grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
          {mockPatients.map(patient => {
              const callResult = mockCallResults.find(cr => cr.patient_id === patient.patient_id);
              if (!callResult) return null;

              return (
                <div key={patient.patient_id} onClick={() => handleCardClick(patient.patient_id)} className="cursor-pointer hover:scale-105 transition-transform duration-200">
                  <TriageCard patient={patient} callResult={callResult} onViewIsbarr={handleViewIsbarr} />
                </div>
              )
          })}
        </div>

        <div className="row-start-1 md:col-start-3 xl:col-start-4 flex flex-col gap-6">
          {selectedPatient && selectedLaceScore && selectedHospitalScore && (
            <>
              <RiskScoreCard 
                laceScore={selectedLaceScore} 
                hospitalScore={selectedHospitalScore} 
              />
              {selectedPatient.patient_id === '1' &&
                <ProtocolReview 
                  protocolReview={mockProtocolReview} 
                  patient={selectedPatient}
                  onApprove={handleApprove}
                  onReject={handleReject}
                />
              }
            </>
          )}
        </div>
      </div>

      {isModalOpen && selectedCallResult?.isbarr_summary && (
        <IsbarrModal 
          isOpen={isModalOpen}
          onClose={() => setIsModalOpen(false)}
          isbarr={selectedCallResult.isbarr_summary}
        />
      )}
    </main>
  );
};


const Page = () => {
  const [isAuthenticated, setIsAuthenticated] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleLogin = async (username: string, password: string) => {
    setIsLoading(true);
    setError(null);
    setTimeout(() => {
      if (username === 'nurse' && password === 'password') {
        setIsAuthenticated(true);
      } else {
        setError('Invalid username or password.');
      }
      setIsLoading(false);
    }, 1000);
  };

  if (!isAuthenticated) {
    return <LoginPage onLogin={handleLogin} error={error} isLoading={isLoading} />;
  }

  return (
    <RealtimeProvider>
      <Dashboard />
    </RealtimeProvider>
  );
};

export default Page;
