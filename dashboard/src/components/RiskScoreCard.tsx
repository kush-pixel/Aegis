"use client";

import React from 'react';
import { LaceScore, HospitalScore } from '@aegis/schemas';

interface RiskScoreCardProps {
  laceScore: LaceScore;
  hospitalScore: HospitalScore;
}

const RiskScoreCard: React.FC<RiskScoreCardProps> = ({ laceScore, hospitalScore }) => {
  const renderScore = (label: string, value: number | undefined) => (
    <div className="flex justify-between items-center py-2">
      <span className="font-sans text-gray-100">{label}</span>
      <span className="font-mono text-lg text-blue-400 font-bold">{value ?? 'N/A'}</span>
    </div>
  );

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 w-full">
      <h3 className="font-sans text-lg font-bold text-gray-100 mb-4">Risk Scores</h3>
      
      <div className="mb-4">
        <h4 className="font-sans font-bold text-gray-400 mb-2">LACE Score</h4>
        <div className="divide-y divide-gray-800">
          {renderScore('Length of Stay', laceScore.length_of_stay)}
          {renderScore('Acuity of Admission', laceScore.acuity)}
          {renderScore('Comorbidities', laceScore.comorbidity)}
          {renderScore('Emergency Dept Visits', laceScore.ed_visits)}
        </div>
        <div className="flex justify-between items-center pt-2 font-bold">
          <span className="font-sans text-blue-400">Total LACE</span>
          <span className="font-mono text-xl text-blue-400">{laceScore.total}</span>
        </div>
      </div>

      <div>
        <h4 className="font-sans font-bold text-gray-400 mb-2">HOSPITAL Score</h4>
        <div className="divide-y divide-gray-800">
          {renderScore('Hemoglobin', hospitalScore.hemoglobin)}
          {renderScore('Oncology', hospitalScore.oncology)}
          {renderScore('Sodium', hospitalScore.sodium)}
          {renderScore('Procedure', hospitalScore.procedure)}
          {renderScore('Index Type of Admission', hospitalScore.index_admission)}
          {renderScore('Total Admits', hospitalScore.num_admissions)}
          {renderScore('ED Visits', hospitalScore.ed_visits)}
        </div>
        <div className="flex justify-between items-center pt-2 font-bold">
          <span className="font-sans text-blue-400">Total HOSPITAL</span>
          <span className="font-mono text-xl text-blue-400">{hospitalScore.total}</span>
        </div>
      </div>
    </div>
  );
};

export default RiskScoreCard;
