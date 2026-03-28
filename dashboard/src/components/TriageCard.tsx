"use client";

import React from 'react';
import { PatientProfile, CallResult, SdohScreening } from '@aegis/schemas';
import SdohFlags from './SdohFlags';

interface TriageCardProps {
  patient: PatientProfile;
  callResult: CallResult;
  onViewIsbarr: () => void;
}

const TriageCard: React.FC<TriageCardProps> = ({ patient, callResult, onViewIsbarr }) => {
  const { name, composite_risk_score, risk_level } = patient;
  const { triage_status, sdoh_responses, broken_rules } = callResult;

  const getTriageClasses = (triageStatus: string) => {
    switch (triageStatus) {
      case 'RED':
        return 'bg-red-950 border-red-800 text-red-400';
      case 'YELLOW':
        return 'bg-yellow-950 border-yellow-800 text-yellow-400';
      case 'GREEN':
        return 'bg-green-950 border-green-800 text-green-400';
      default:
        return 'bg-gray-800 border-gray-700 text-gray-400';
    }
  };

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 w-full flex flex-col justify-between">
      <div>
        <div className="flex justify-between items-start">
          <div className="flex-grow">
            <h2 className="text-xl font-sans font-bold text-gray-100">{name}</h2>
            <p className="text-sm text-gray-400 font-sans">{risk_level}</p>
          </div>
          <div className={`text-lg font-bold px-4 py-2 rounded ${getTriageClasses(triage_status)}`}>
            {triage_status}
          </div>
        </div>

        <div className="my-2">
          <div className="flex justify-between items-center">
            <span className="text-gray-400 font-sans">Composite Risk</span>
            <span className="text-blue-400 font-mono font-bold text-xl">{composite_risk_score.toFixed(2)}</span>
          </div>
          <div className="w-full bg-gray-800 rounded-full h-2.5 mt-1">
            <div className="bg-blue-400 h-2.5 rounded-full" style={{ width: `${composite_risk_score}%` }}></div>
          </div>
        </div>

        {broken_rules && broken_rules.length > 0 && (
          <div className="my-2">
            <h3 className="text-gray-400 font-sans font-bold mb-2">Broken Rules</h3>
            <div className="space-y-1">
              {broken_rules.map((rule, index) => (
                <div key={index} className="text-sm font-mono text-red-400 bg-red-950 border border-red-800 rounded px-2 py-1">
                  {rule}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="mt-auto space-y-4">
        <SdohFlags sdohScreening={sdoh_responses} />
        <button
          onClick={onViewIsbarr}
          className="w-full bg-blue-500 text-white font-bold py-2 px-3 rounded-lg hover:bg-blue-600 transition-colors focus:outline-none"
        >
          View ISBARR
        </button>
      </div>
    </div>
  );
};

export default TriageCard;
