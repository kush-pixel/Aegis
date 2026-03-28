"use client";

import React, { createContext, useContext, useEffect, useReducer, ReactNode } from 'react';
import { CallResult } from '@aegis/schemas';

// TODO: Replace with actual AppSync client
const AppSyncClient: any = {
  subscribe: (options: { query: any; variables: any; }, callback: (data: any) => void) => {
    const interval = setInterval(() => {
      // Simulate receiving data
    }, 5000);

    return {
      unsubscribe: () => {
        clearInterval(interval);
      }
    };
  }
};

// GraphQL query for subscriptions (placeholder)
const SUBSCRIBE_CALL_RESULTS = `
  subscription OnCallResultUpdate {
    onCallResultUpdate {
      // ... fields from CallResult
    }
  }
`;

interface RealtimeState {
  callResults: CallResult[];
  error: Error | null;
  status: 'connecting' | 'connected' | 'disconnected';
}

type RealtimeAction =
  | { type: 'CONNECTION_SUCCESS' }
  | { type: 'CONNECTION_ERROR'; payload: Error }
  | { type: 'DISCONNECTED' }
  | { type: 'CALL_RESULT_UPDATE'; payload: CallResult };

const initialState: RealtimeState = {
  callResults: [],
  error: null,
  status: 'disconnected',
};

const reducer = (state: RealtimeState, action: RealtimeAction): RealtimeState => {
  switch (action.type) {
    case 'CONNECTION_SUCCESS':
      return { ...state, status: 'connected', error: null };
    case 'CONNECTION_ERROR':
      return { ...state, status: 'disconnected', error: action.payload };
    case 'DISCONNECTED':
      return { ...state, status: 'disconnected' };
    case 'CALL_RESULT_UPDATE': {
      const updatedCallResult = action.payload;
      const existingCallResultIndex = state.callResults.findIndex(c => c.call_id === updatedCallResult.call_id);
      if (existingCallResultIndex > -1) {
        const newCallResults = [...state.callResults];
        newCallResults[existingCallResultIndex] = updatedCallResult;
        return { ...state, callResults: newCallResults };
      }
      return { ...state, callResults: [...state.callResults, updatedCallResult] };
    }
    default:
      return state;
  }
};

const RealtimeStateContext = createContext<RealtimeState>(initialState);
const RealtimeDispatchContext = createContext<React.Dispatch<RealtimeAction> | undefined>(undefined);

interface RealtimeProviderProps {
  children: ReactNode;
}

export const RealtimeProvider = ({ children }: RealtimeProviderProps) => {
  const [state, dispatch] = useReducer(reducer, initialState);

  useEffect(() => {
    // TODO: Implement actual AppSync WebSocket connection
    dispatch({ type: 'CONNECTION_SUCCESS' }); // Simulate success

    const subscription = AppSyncClient.subscribe(
      { query: SUBSCRIBE_CALL_RESULTS, variables: {} },
      (data: any) => {
        // Assuming data contains a call result
        // dispatch({ type: 'CALL_RESULT_UPDATE', payload: data.data.onCallResultUpdate });
      }
    );

    return () => {
      subscription.unsubscribe();
      dispatch({ type: 'DISCONNECTED' });
    };
  }, []);

  return (
    <RealtimeStateContext.Provider value={state}>
      <RealtimeDispatchContext.Provider value={dispatch}>
        {children}
      </RealtimeDispatchContext.Provider>
    </RealtimeStateContext.Provider>
  );
};

export const useRealtimeState = () => {
  const context = useContext(RealtimeStateContext);
  if (context === undefined) {
    throw new Error('useRealtimeState must be used within a RealtimeProvider');
  }
  return context;
};

export const useRealtimeDispatch = () => {
  const context = useContext(RealtimeDispatchContext);
  if (context === undefined) {
    throw new Error('useRealtimeDispatch must be used within a RealtimeProvider');
  }
  return context;
};
