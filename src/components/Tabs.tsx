import { createContext, useContext, useState, type ReactNode } from 'react';

interface TabsContextValue {
  active: string;
  setActive: (value: string) => void;
}

const TabsContext = createContext<TabsContextValue | undefined>(undefined);

interface TabsProps {
  defaultValue: string;
  value?: string;
  onChange?: (value: string) => void;
  children: ReactNode;
  className?: string;
}

export function Tabs({ defaultValue, value, onChange, children, className = '' }: TabsProps) {
  const [internal, setInternal] = useState(defaultValue);
  const active = value ?? internal;
  const setActive = (v: string) => { setInternal(v); onChange?.(v); };
  return (
    <TabsContext.Provider value={{ active, setActive }}>
      <div className={className}>{children}</div>
    </TabsContext.Provider>
  );
}

interface TabListProps {
  children: ReactNode;
  className?: string;
}

export function TabList({ children, className = '' }: TabListProps) {
  return (
    <div role="tablist" className={`inline-flex max-w-full flex-wrap gap-1 rounded-full border border-ui-border bg-ui-page-alt p-1 ${className}`}>
      {children}
    </div>
  );
}

interface TabTriggerProps {
  value: string;
  children: ReactNode;
  className?: string;
}

export function TabTrigger({ value, children, className = '' }: TabTriggerProps) {
  const ctx = useContext(TabsContext);
  if (!ctx) throw new Error('TabTrigger must be used within Tabs');
  const isActive = ctx.active === value;
  return (
    <button
      role="tab"
      type="button"
      aria-selected={isActive}
      onClick={() => ctx.setActive(value)}
      className={`relative whitespace-nowrap rounded-full px-4 py-1.5 text-[13px] font-semibold transition-all duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ui-ring ${
        isActive ? 'bg-ui-text text-ui-surface shadow-ui-sm' : 'text-ui-muted hover:text-ui-text'
      } ${className}`}
    >
      {children}
    </button>
  );
}

interface TabContentProps {
  value: string;
  children: ReactNode;
  className?: string;
}

export function TabContent({ value, children, className = '' }: TabContentProps) {
  const ctx = useContext(TabsContext);
  if (!ctx) throw new Error('TabContent must be used within Tabs');
  if (ctx.active !== value) return null;
  return (
    <div role="tabpanel" className={`pt-4 ${className}`}>
      {children}
    </div>
  );
}
