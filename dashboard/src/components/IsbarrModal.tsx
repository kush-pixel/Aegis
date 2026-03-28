"use client";

import React from 'react';
import { Isbarr } from '@aegis/schemas';

interface IsbarrModalProps {
  isOpen: boolean;
  onClose: () => void;
  isbarr: Isbarr;
}

const IsbarrModal: React.FC<IsbarrModalProps> = ({ isOpen, onClose, isbarr }) => {
  if (!isOpen) {
    return null;
  }

  const sections = [
    { title: 'Identity', content: isbarr.identify },
    { title: 'Situation', content: isbarr.situation },
    { title: 'Background', content: isbarr.background },
    { title: 'Assessment', content: isbarr.assessment },
    { title: 'Recommendation', content: isbarr.recommendation },
    { title: 'Readback', content: isbarr.read_back },
  ];

  return (
    <div className="fixed inset-0 bg-gray-950 bg-opacity-75 flex items-center justify-center z-50">
      <div className="bg-gray-900 rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto p-6 border border-gray-800">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-2xl font-bold font-sans text-gray-100">ISBARR Handover</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-100">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="space-y-4">
          {sections.map(section => (
            <div key={section.title}>
              <p className="text-xs uppercase text-gray-400 font-bold tracking-wider mb-1">{section.title}</p>
              {section.content ? (
                <p className="text-gray-100 font-sans">{section.content}</p>
              ) : (
                <p className="text-gray-500 font-sans italic">Pending nurse callback</p>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default IsbarrModal;
