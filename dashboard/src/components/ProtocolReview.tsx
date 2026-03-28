"use client";

import React from 'react';
import { ProtocolReview, PatientProfile } from '@aegis/schemas';

interface ProtocolReviewProps {
  protocolReview: ProtocolReview;
  patient: PatientProfile;
  onApprove: (reviewId: string) => void;
  onReject: (reviewId: string) => void;
}

const ProtocolReviewCard: React.FC<ProtocolReviewProps> = ({ protocolReview, patient, onApprove, onReject }) => {
  const { review_id, protocol_id, status, confidence_score } = protocolReview;
  const { name } = patient;

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-lg p-6 w-full h-full flex flex-col">
      <h2 className="text-xl font-bold font-sans text-gray-100 mb-4">Protocol Review</h2>
      
      <div className="flex-grow overflow-y-auto pr-2">
        <div className="mb-4">
          <p className="text-gray-400 font-sans">Patient:</p>
          <p className="text-gray-100 font-sans font-bold text-lg">{name}</p>
        </div>

        <div className="mb-4">
          <p className="text-gray-400 font-sans">Protocol ID:</p>
          <p className="text-gray-100 font-mono font-bold text-lg">{protocol_id}</p>
        </div>

        <div className="mb-4">
          <p className="text-gray-400 font-sans">Status:</p>
          <p className={`font-sans font-bold text-lg ${
            status === 'APPROVED' || status === 'AUTO_APPROVED' ? 'text-green-400' : 'text-yellow-400'
          }`}>
            {status}
          </p>
        </div>
        
        <div className="mb-4">
          <p className="text-gray-400 font-sans">Confidence Score:</p>
          <p className="text-blue-400 font-mono font-bold text-xl">{confidence_score.toFixed(2)}</p>
        </div>
      </div>
      
      <div className="mt-6 flex justify-end space-x-4">
        <button 
          onClick={() => onReject(review_id)}
          className="bg-red-950 text-red-400 border border-red-800 rounded-md px-6 py-2 font-bold hover:bg-red-900 transition-colors"
        >
          Reject
        </button>
        <button 
          onClick={() => onApprove(review_id)}
          className="bg-green-950 text-green-400 border border-green-800 rounded-md px-6 py-2 font-bold hover:bg-green-900 transition-colors"
        >
          Approve
        </button>
      </div>
    </div>
  );
};

export default ProtocolReviewCard;
