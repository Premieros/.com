import { createContext, useContext, type ReactNode } from 'react';

const EmbeddedCenterPageContext = createContext(false);

export function EmbeddedCenterPage({ children }: { children: ReactNode }) {
  return <EmbeddedCenterPageContext.Provider value={true}>{children}</EmbeddedCenterPageContext.Provider>;
}

export function useEmbeddedCenterPage() {
  return useContext(EmbeddedCenterPageContext);
}
