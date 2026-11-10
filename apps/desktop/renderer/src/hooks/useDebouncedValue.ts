import { useEffect, useState } from 'react';
export function useDebouncedValue<T>(value: T, delay = 200) {
  const [debounced, set] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => set(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}
