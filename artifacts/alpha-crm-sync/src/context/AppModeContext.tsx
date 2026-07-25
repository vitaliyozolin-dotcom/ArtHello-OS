import { createContext, useContext, useState, type ReactNode } from 'react';

type AppMode = 'owner' | 'technical';

interface AppModeContextValue {
  mode: AppMode;
  isOwner: boolean;
  isTechnical: boolean;
  toggleMode: () => void;
}

const AppModeContext = createContext<AppModeContextValue | null>(null);

function getStoredMode(): AppMode {
  try {
    const v = localStorage.getItem('arthello-mode');
    return v === 'technical' ? 'technical' : 'owner';
  } catch {
    return 'owner';
  }
}

export function AppModeProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<AppMode>(getStoredMode);

  const toggleMode = () => {
    setMode((prev) => {
      const next = prev === 'owner' ? 'technical' : 'owner';
      try { localStorage.setItem('arthello-mode', next); } catch {}
      return next;
    });
  };

  return (
    <AppModeContext.Provider value={{ mode, isOwner: mode === 'owner', isTechnical: mode === 'technical', toggleMode }}>
      {children}
    </AppModeContext.Provider>
  );
}

export function useAppMode() {
  const ctx = useContext(AppModeContext);
  if (!ctx) throw new Error('useAppMode must be used inside AppModeProvider');
  return ctx;
}
