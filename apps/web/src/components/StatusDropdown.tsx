import { useState, useRef, useEffect } from 'react';
import { ChevronDown, Check, Circle } from 'lucide-react';
import type { User } from '../api';
import { updateUserStatus } from '../api';

interface Props {
  user: User;
  token: string;
  onStatusChange: (status: 'available' | 'dnd' | 'away') => void;
}

export default function StatusDropdown({ user, token, onStatusChange }: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  
  // Use the local storage value as source of truth initially to match SipContext,
  // falling back to the user object's status.
  const [currentStatus, setCurrentStatus] = useState<'available' | 'dnd' | 'away'>(
    (sessionStorage.getItem('aptlink_status') as any) || user.status || 'available'
  );

  // Sync if user object changes externally
  useEffect(() => {
    if (user.status && user.status !== currentStatus) {
      setCurrentStatus(user.status as 'available' | 'dnd' | 'away');
      sessionStorage.setItem('aptlink_status', user.status);
    }
  }, [user.status]);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const handleSelect = async (status: 'available' | 'dnd' | 'away') => {
    setIsOpen(false);
    // Optimistic UI update
    setCurrentStatus(status);
    sessionStorage.setItem('aptlink_status', status);
    onStatusChange(status);
    
    try {
      await updateUserStatus(token, status);
    } catch (e) {
      console.error('Failed to update status', e);
      // Revert on failure
      const reverted = (user.status as 'available' | 'dnd' | 'away') || 'available';
      setCurrentStatus(reverted);
      sessionStorage.setItem('aptlink_status', reverted);
      onStatusChange(reverted);
    }
  };

  const getStatusConfig = (status: string) => {
    switch (status) {
      case 'dnd':
        return { label: 'Do Not Disturb', color: 'bg-red-500', dot: 'text-red-500', desc: 'Silently reject incoming calls' };
      case 'away':
        return { label: 'Away', color: 'bg-yellow-500', dot: 'text-yellow-500', desc: 'Show as inactive to teammates' };
      case 'available':
      default:
        return { label: 'Available', color: 'bg-green-500', dot: 'text-green-500', desc: 'Receive calls and messages' };
    }
  };

  const config = getStatusConfig(currentStatus);

  return (
    <div className="relative" ref={containerRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/5 border border-white/10 hover:bg-white/10 transition-colors text-sm font-medium"
      >
        <span className={`w-2.5 h-2.5 rounded-full ${config.color} shadow-[0_0_8px_rgba(0,0,0,0.5)] shadow-${config.color.split('-')[1]}-500/50`} />
        {config.label}
        <ChevronDown className="w-3.5 h-3.5 text-white/50" />
      </button>

      {isOpen && (
        <div className="absolute right-0 top-full mt-2 w-56 bg-slate-800 border border-white/10 rounded-xl shadow-xl overflow-hidden z-50">
          <div className="p-1">
            {(['available', 'dnd', 'away'] as const).map((s) => {
              const sc = getStatusConfig(s);
              const isActive = s === currentStatus;
              return (
                <button
                  key={s}
                  onClick={() => handleSelect(s)}
                  className={`w-full text-left flex flex-col p-2 rounded-lg transition-colors ${
                    isActive ? 'bg-white/10' : 'hover:bg-white/5'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Circle className={`w-3 h-3 fill-current ${sc.dot}`} />
                      <span className="font-medium">{sc.label}</span>
                    </div>
                    {isActive && <Check className="w-4 h-4 text-white/50" />}
                  </div>
                  <span className="text-xs text-white/50 pl-5 mt-0.5">{sc.desc}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
