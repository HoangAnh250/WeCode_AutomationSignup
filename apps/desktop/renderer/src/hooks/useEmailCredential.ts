import { useEffect, useState } from 'react';
import { client } from '@/ipc/client';

// Only the active form holds the plaintext. It is not part of workspace/query/persisted stores.
export function useEmailCredential(id?: string) {
  const [password, setPassword] = useState('');
  const [savedPassword, setSavedPassword] = useState('');
  const [loading, setLoading] = useState(Boolean(id));
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setPassword('');
    setSavedPassword('');
    setError('');
    setLoading(Boolean(id));
    if (id) {
      void client.getEmailAppPassword(id).then(
        (value) => {
          if (!cancelled) {
            setPassword(value);
            setSavedPassword(value);
            setLoading(false);
          }
        },
        () => {
          if (!cancelled) {
            setError(
              'Could not load the saved App Password. Retry loading or enter a replacement. Leaving it blank keeps the stored password.',
            );
            setLoading(false);
          }
        },
      );
    }
    return () => {
      cancelled = true;
    };
  }, [id, attempt]);
  return {
    password,
    setPassword,
    savedPassword,
    loading,
    error,
    reload: () => setAttempt((value) => value + 1),
    markSaved: (value: string) => {
      setPassword(value);
      setSavedPassword(value);
      setError('');
    },
  };
}
