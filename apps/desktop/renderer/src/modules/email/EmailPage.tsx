import { useState, useMemo, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Mail, ShieldCheck, Save, RefreshCw, Eye, EyeOff, Inbox, Globe } from 'lucide-react';
import { PageHeader } from '@/components/shared/PageHeader';
import { Field } from '@/components/shared/Field';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { useCommand } from '@/hooks/useWorkspace';
import { client } from '@/ipc/client';
import { useEmailCredential } from '@/hooks/useEmailCredential';
import type { WorkspaceData } from '@/types/domain';
import { EmailFlow, exampleAccountEmail } from './EmailFlow';
export function EmailPage({ data }: { data: WorkspaceData }) {
  const [domain, setDomain] = useState(data.email.accountDomain ?? data.preferences.catchallDomain);
  const [address, setAddress] = useState(data.email.address);
  const [host, setHost] = useState(data.email.host ?? 'imap.gmail.com');
  const [port, setPort] = useState(data.email.port ?? 993);
  const [mailbox, setMailbox] = useState(data.email.mailbox ?? 'INBOX');
  const credential = useEmailCredential(data.email.id);
  const { password, setPassword } = credential;
  const normalizePassword = (value: string) =>
    host.trim().toLowerCase() === 'imap.gmail.com' ? value.replace(/\s/g, '') : value;
  const passwordChanged =
    Boolean(password.trim()) &&
    normalizePassword(password) !== normalizePassword(credential.savedPassword);
  const [visible, setVisible] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    setDomain(data.email.accountDomain ?? data.preferences.catchallDomain);
    setAddress(data.email.address);
    setHost(data.email.host ?? 'imap.gmail.com');
    setPort(data.email.port ?? 993);
    setMailbox(data.email.mailbox ?? 'INBOX');
  }, [
    data.email.id,
    data.email.accountDomain,
    data.email.address,
    data.email.host,
    data.email.port,
    data.email.mailbox,
    data.preferences.catchallDomain,
  ]);
  const inboxDirty =
    address.trim() !== data.email.address ||
    host.trim() !== (data.email.host ?? 'imap.gmail.com') ||
    port !== (data.email.port ?? 993) ||
    mailbox.trim() !== (data.email.mailbox ?? 'INBOX') ||
    passwordChanged;
  const preview = useMemo(() => exampleAccountEmail(domain.trim()), [domain]);
  const tracking = useQuery({
    queryKey: ['email-verifications', data.email.id ?? data.email.address],
    queryFn: () => client.getEmailVerifications(),
    enabled: data.email.configured,
    refetchInterval: 10000,
    retry: false,
  });
  const save = useCommand(async () => {
    if (!preview) throw new Error('Enter a valid Account Email Domain, without @ or https://.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address))
      throw new Error('Enter a valid OTP inbox address.');
    if (!data.email.configured && !password.trim())
      throw new Error('Enter an App Password for the OTP inbox.');
    if (!Number.isInteger(port) || port < 1 || port > 65535)
      throw new Error('Enter a valid IMAP port.');
    await client.saveEmail(address.trim(), passwordChanged ? password.trim() : undefined, {
      accountDomain: domain.trim().toLowerCase(),
      host: host.trim(),
      port,
      mailbox: mailbox.trim(),
    });
    credential.markSaved(password.trim() || credential.savedPassword);
    setVisible(false);
    if (!password.trim() && !credential.savedPassword && data.email.configured) credential.reload();
  }, 'Account domain and OTP inbox settings saved.');
  const test = useCommand(
    () => client.testEmail(),
    'IMAP inbox connection confirmed. Catch-all delivery is a separate check.',
  );
  return (
    <>
      <PageHeader
        title="Email integration"
        description="Generate signup emails on your account domain; read forwarded OTPs from a separate inbox."
      />
      <div className="settings-layout">
        <section className="panel settings-panel">
          <div className="panel-heading">
            <div className="icon-heading">
              <span className="resource-icon">
                <Mail size={20} />
              </span>
              <div>
                <h2>Account email and OTP inbox</h2>
                <p>Two addresses with separate responsibilities.</p>
              </div>
            </div>
            <Badge value={data.email.status} label={`IMAP: ${data.email.status}`} />
          </div>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              setError('');
              if (password && password.replaceAll(' ', '').length < 8) {
                setError('The App Password appears incomplete.');
                return;
              }
              save.mutate(undefined);
            }}
          >
            <div className="form-stack">
              <div className="icon-heading">
                <Globe size={18} />
                <h3>Account identity</h3>
              </div>
              <Field
                label="Account Email Domain"
                hint="Used only to generate signup addresses, for example alex123@mytic.website."
              >
                {(id) => (
                  <Input
                    id={id}
                    value={domain}
                    required
                    placeholder="mytic.website"
                    autoCapitalize="none"
                    spellCheck={false}
                    onChange={(event) => setDomain(event.target.value)}
                  />
                )}
              </Field>
              <Field
                label="Generated Email Preview"
                hint="Example only. It is not reserved or sent; signup generates a new identity using this domain."
              >
                {(id) => (
                  <Input
                    id={id}
                    value={preview}
                    readOnly
                    placeholder="Configure a valid account domain"
                  />
                )}
              </Field>
              <div className="icon-heading">
                <Inbox size={18} />
                <h3>OTP inbox</h3>
              </div>
              <Field
                label="Gmail address"
                hint="Receiving inbox only, for example alo123@gmail.com. This address is not used for signup."
              >
                {(id) => (
                  <Input
                    id={id}
                    type="email"
                    autoComplete="username"
                    value={address}
                    required
                    onChange={(event) => setAddress(event.target.value)}
                    placeholder="alo123@gmail.com"
                  />
                )}
              </Field>
              <Field
                label="App Password"
                hint={
                  data.email.configured
                    ? 'Saved securely and reloaded when you reopen this page. Use Show Password to view it.'
                    : 'Gmail App Password used only to sign in to the OTP inbox through IMAP.'
                }
              >
                {(id) => (
                  <div className="password-input">
                    <Input
                      id={id}
                      type={visible ? 'text' : 'password'}
                      autoComplete="off"
                      spellCheck={false}
                      autoCapitalize="none"
                      disabled={credential.loading || save.isPending}
                      aria-busy={credential.loading}
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      placeholder={
                        data.email.configured
                          ? credential.loading
                            ? 'Loading saved password...'
                            : 'Enter a replacement or leave blank to keep saved password'
                          : 'Enter your Gmail App Password'
                      }
                    />
                    <Button
                      variant="ghost"
                      disabled={credential.loading || !password}
                      aria-pressed={visible}
                      aria-label={visible ? 'Hide App Password' : 'Show App Password'}
                      onClick={() => setVisible(!visible)}
                    >
                      {visible ? (
                        <EyeOff size={16} aria-hidden="true" />
                      ) : (
                        <Eye size={16} aria-hidden="true" />
                      )}
                      {visible ? 'Hide Password' : 'Show Password'}
                    </Button>
                  </div>
                )}
              </Field>
              {credential.loading && (
                <p className="small-text muted" role="status">
                  Loading saved App Password...
                </p>
              )}
              {credential.error && (
                <div>
                  <p role="alert" className="form-error">
                    {credential.error}
                  </p>
                  <Button onClick={credential.reload} disabled={save.isPending}>
                    Reload saved password
                  </Button>
                </div>
              )}
              <details className="imap-details">
                <summary>Advanced IMAP settings</summary>
                <div className="form-stack">
                  <Field label="IMAP host">
                    {(id) => (
                      <Input
                        id={id}
                        value={host}
                        required
                        onChange={(event) => setHost(event.target.value)}
                        placeholder="imap.gmail.com"
                      />
                    )}
                  </Field>
                  <div className="form-grid">
                    <Field label="IMAP port">
                      {(id) => (
                        <Input
                          id={id}
                          type="number"
                          min={1}
                          max={65535}
                          value={port}
                          required
                          onChange={(event) => setPort(Number(event.target.value))}
                        />
                      )}
                    </Field>
                    <Field label="IMAP folder">
                      {(id) => (
                        <Input
                          id={id}
                          value={mailbox}
                          required
                          onChange={(event) => setMailbox(event.target.value)}
                          placeholder="INBOX"
                        />
                      )}
                    </Field>
                  </div>
                  <p className="small-text muted">
                    TLS is always enabled. Save changes before testing the connection.
                  </p>
                </div>
              </details>
              {error && (
                <p role="alert" className="form-error">
                  {error}
                </p>
              )}
              <div className="inline-note">
                <ShieldCheck size={17} />
                <span>
                  App Passwords stay in encrypted backend storage. Account domains and inbox
                  settings do not contain account passwords or OTP codes.
                </span>
              </div>
            </div>
            <div className="settings-footer">
              <Button
                disabled={
                  !data.email.configured ||
                  inboxDirty ||
                  credential.loading ||
                  test.isPending ||
                  save.isPending
                }
                onClick={() => test.mutate(undefined)}
              >
                <RefreshCw size={15} />
                {test.isPending ? 'Testing...' : 'Test connection'}
              </Button>
              <Button
                type="submit"
                variant="default"
                disabled={save.isPending || credential.loading}
              >
                <Save size={15} />
                {save.isPending ? 'Saving...' : 'Save connection'}
              </Button>
            </div>
          </form>
        </section>
        <aside className="panel help-panel">
          <Globe size={24} />
          <h2>Catch-all forwarding</h2>
          <p>
            Configure your domain provider to forward mail sent to any address at your account
            domain into the OTP inbox.
          </p>
          <div className="help-item">
            <span>1</span>
            <p>Account domain generates signup email addresses.</p>
          </div>
          <div className="help-item">
            <span>2</span>
            <p>Forwarding delivers those messages to Gmail.</p>
          </div>
          <div className="help-item">
            <span>3</span>
            <p>
              IMAP matches the original recipient, sender and verification time window before
              extracting an OTP.
            </p>
          </div>
          <p className="small-text muted">
            The app does not create DNS records or forwarding rules. Missing original-recipient
            headers cause a safe non-match; the Gmail inbox address is not substituted.
          </p>
        </aside>
      </div>
      <EmailFlow accountEmail={preview} inbox={address} />
      <section className="panel settings-panel">
        <div className="panel-heading">
          <div>
            <h2>Verification tracking</h2>
            <p>Recent requests for the selected OTP inbox. Codes are never shown in this list.</p>
          </div>
          <Button
            disabled={!data.email.configured || tracking.isFetching}
            onClick={() => void tracking.refetch()}
          >
            <RefreshCw size={15} />
            Refresh status
          </Button>
        </div>
        {tracking.isError ? (
          <p role="alert" className="form-error">
            {tracking.error.message}
          </p>
        ) : tracking.isPending && data.email.configured ? (
          <p className="page-footnote" role="status">
            Loading verification requests...
          </p>
        ) : tracking.data?.length ? (
          <div className="email-tracking">
            <table aria-label="Email verification requests">
              <thead>
                <tr>
                  <th>Account email</th>
                  <th>Expected sender</th>
                  <th>Status</th>
                  <th>Requested</th>
                </tr>
              </thead>
              <tbody>
                {tracking.data.map((item) => (
                  <tr key={item.id}>
                    <td>{item.recipient}</td>
                    <td>{item.sender}</td>
                    <td>{item.status}</td>
                    <td>{new Date(item.requestedAt).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="page-footnote">
            No verification requests yet. Account creation workflows add requests here when they
            wait for an OTP.
          </p>
        )}
      </section>
    </>
  );
}
