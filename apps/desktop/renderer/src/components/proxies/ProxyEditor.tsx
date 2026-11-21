import { useState } from 'react';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/input';
import { Field } from '@/components/shared/Field';
import type { Proxy, ProxyEditInput } from '@/types/domain';
export function ProxyEditor({
  proxies,
  pending,
  progress,
  onClose,
  onSave,
}: {
  proxies: Proxy[];
  pending: boolean;
  progress: string;
  onClose: () => void;
  onSave: (input: ProxyEditInput) => Promise<void>;
}) {
  const single = proxies.length === 1;
  const [host, setHost] = useState(single ? proxies[0].host : '');
  const [port, setPort] = useState(single ? String(proxies[0].port) : '');
  const [protocol, setProtocol] = useState(single ? proxies[0].protocol : '');
  const [authMode, setAuthMode] = useState<ProxyEditInput['authMode']>('keep');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [visible, setVisible] = useState(false);
  const [error, setError] = useState('');
  return (
    <Dialog
      open
      title={single ? 'Edit proxy' : 'Edit selected proxies'}
      description={`${proxies.length} proxy entries. Connection changes reset health to Unchecked. Active or saved browser bindings may prevent editing.`}
      onOpenChange={(open) => !open && !pending && onClose()}
    >
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          setError('');
          if (single && !host.trim()) {
            setError('Enter a hostname.');
            return;
          }
          if (
            port &&
            (!Number.isInteger(Number(port)) || Number(port) < 1 || Number(port) > 65535)
          ) {
            setError('Port must be 1-65535.');
            return;
          }
          if (authMode === 'replace' && (!username || !password)) {
            setError('Enter both username and password.');
            return;
          }
          try {
            await onSave({
              ...(single ? { host: host.trim() } : {}),
              ...(port ? { port: Number(port) } : {}),
              ...(protocol ? { protocol: protocol as Proxy['protocol'] } : {}),
              authMode,
              ...(authMode === 'replace' ? { username, password } : {}),
            });
          } catch (error) {
            setError(error instanceof Error ? error.message : 'Could not save the proxy.');
          }
        }}
      >
        <fieldset className="proxy-editor-fields form-stack" disabled={pending}>
          {single && (
            <Field label="Hostname">
              {(id) => (
                <Input
                  id={id}
                  autoFocus
                  value={host}
                  maxLength={253}
                  onChange={(e) => setHost(e.target.value)}
                />
              )}
            </Field>
          )}
          <div className="form-grid">
            <Field label="Protocol">
              {(id) => (
                <Select id={id} value={protocol} onChange={(e) => setProtocol(e.target.value)}>
                  {!single && <option value="">Keep each proxy's protocol</option>}
                  <option value="http">HTTP</option>
                  <option value="https">HTTPS</option>
                  <option value="socks5">SOCKS5</option>
                </Select>
              )}
            </Field>
            <Field label="Port" hint={!single ? 'Leave blank to keep each port.' : undefined}>
              {(id) => (
                <Input
                  id={id}
                  type="number"
                  min={1}
                  max={65535}
                  value={port}
                  onChange={(e) => setPort(e.target.value)}
                />
              )}
            </Field>
          </div>
          <Field
            label="Authentication"
            hint="Saved credentials remain encrypted and are not loaded into this form."
          >
            {(id) => (
              <Select
                id={id}
                value={authMode}
                onChange={(e) => setAuthMode(e.target.value as ProxyEditInput['authMode'])}
              >
                <option value="keep">Keep saved credentials</option>
                <option value="replace">Replace credentials</option>
                <option value="remove">Remove credentials</option>
              </Select>
            )}
          </Field>
          {authMode === 'replace' && (
            <>
              <Field label="Proxy username">
                {(id) => (
                  <Input
                    id={id}
                    value={username}
                    maxLength={256}
                    autoComplete="off"
                    onChange={(e) => setUsername(e.target.value)}
                  />
                )}
              </Field>
              <Field label="Proxy password">
                {(id) => (
                  <div className="password-field">
                    <Input
                      id={id}
                      type={visible ? 'text' : 'password'}
                      value={password}
                      maxLength={512}
                      autoComplete="new-password"
                      onChange={(e) => setPassword(e.target.value)}
                    />
                    <Button type="button" onClick={() => setVisible(!visible)}>
                      {visible ? 'Hide' : 'Show'}
                    </Button>
                  </div>
                )}
              </Field>
            </>
          )}
          {error && (
            <p role="alert" className="form-error">
              {error}
            </p>
          )}
          {pending && <p role="status">{progress}</p>}
        </fieldset>
        <div className="dialog-footer">
          <Button type="button" disabled={pending} onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            variant="default"
            disabled={pending || (!single && !protocol && !port && authMode === 'keep')}
          >
            {pending ? 'Saving...' : single ? 'Save proxy' : `Save ${proxies.length} proxies`}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
