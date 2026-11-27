import { useEffect, useState } from 'react';

/**
 * Debounces a fast-changing value by the given delay in milliseconds.
 * Used for server-side search inputs to prevent hammering the database on every keystroke.
 */
export function useDebouncedValue<T>(value: T, delay = 250): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    return () => {
      clearTimeout(timer);
    };
  }, [value, delay]);

  return debouncedValue;
}
