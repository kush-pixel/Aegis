"use client";

import React from 'react';
import { SdohScreening } from '@aegis/schemas';

interface SdohFlagsProps {
  sdohScreening: SdohScreening;
}

const SdohFlags: React.FC<SdohFlagsProps> = ({ sdohScreening }) => {
  const { medication_cost_barrier, transportation_barrier } = sdohScreening;

  if (!medication_cost_barrier && !transportation_barrier) {
    return null;
  }

  return (
    <div className="flex items-center space-x-2">
      {medication_cost_barrier && (
        <span className="inline-block bg-yellow-950 text-yellow-400 border border-yellow-800 text-xs font-mono font-bold px-2.5 py-0.5 rounded-full">
          MEDICATION COST BARRIER
        </span>
      )}
      {transportation_barrier && (
        <span className="inline-block bg-yellow-950 text-yellow-400 border border-yellow-800 text-xs font-mono font-bold px-2.5 py-0.5 rounded-full">
          TRANSPORTATION BARRIER
        </span>
      )}
    </div>
  );
};

export default SdohFlags;
