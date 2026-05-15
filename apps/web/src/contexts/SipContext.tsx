import { createContext, useContext, useEffect, useState } from 'react';
import { sipService, type SipState, type CallEvent } from '../services/sip';

interface SipContextValue {
  sipState: SipState;
  callState: CallEvent;
  call: (number: string) => void;
  hangup: () => void;
  toggleMute: () => boolean;
  sendDTMF: (digit: string) => void;
}

const SipContext = createContext<SipContextValue | null>(null);

export function SipProvider({ children }: { children: React.ReactNode }) {
  const [sipState, setSipState] = useState<SipState>('disconnected');
  const [callState, setCallState] = useState<CallEvent>({ state: 'idle' });

  useEffect(() => {
    const username = import.meta.env.VITE_SIP_USERNAME as string | undefined;
    const password = import.meta.env.VITE_SIP_PASSWORD as string | undefined;
    const callerNumber = import.meta.env.VITE_SIP_FROM_NUMBER as string | undefined;

    if (!username || !password) {
      console.warn('[sip] missing VITE_SIP_USERNAME or VITE_SIP_PASSWORD — calls disabled');
      setSipState('failed');
      return;
    }

    sipService.connect({ username, password, callerNumber });

    const offState = sipService.on<SipState>('state', (s) => setSipState(s));
    const offCall = sipService.on<CallEvent>('call', (e) => setCallState(e));

    return () => {
      offState();
      offCall();
      sipService.disconnect();
    };
  }, []);

  const value: SipContextValue = {
    sipState,
    callState,
    call: (number) => sipService.call(number),
    hangup: () => sipService.hangup(),
    toggleMute: () => sipService.toggleMute(),
    sendDTMF: (digit) => sipService.sendDTMF(digit),
  };

  return <SipContext.Provider value={value}>{children}</SipContext.Provider>;
}

export function useSip(): SipContextValue {
  const ctx = useContext(SipContext);
  if (!ctx) throw new Error('useSip must be used inside <SipProvider>');
  return ctx;
}
