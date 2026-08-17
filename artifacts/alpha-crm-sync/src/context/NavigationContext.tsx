import { createContext, useContext, type ReactNode } from 'react';

type NavigateFn = (section: string) => void;

const NavigationContext = createContext<NavigateFn | null>(null);

export function NavigationProvider({
  children,
  onNavigate,
}: {
  children: ReactNode;
  onNavigate: NavigateFn;
}) {
  return (
    <NavigationContext.Provider value={onNavigate}>
      {children}
    </NavigationContext.Provider>
  );
}

export function useNavigation(): NavigateFn {
  return useContext(NavigationContext) ?? (() => {});
}
