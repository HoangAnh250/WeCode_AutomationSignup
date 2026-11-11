import { useState } from 'react';
import { appVersion, appBuildTime } from '@/lib/app-info';
import { Save, SlidersHorizontal, KeyRound, Monitor, ShieldCheck } from 'lucide-react';
import { PageHeader } from '@/components/shared/PageHeader';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/input';
import { Field } from '@/components/shared/Field';
import { useCommand } from '@/hooks/useWorkspace';
import { useWorkbench } from '@/stores/workbench.store';
import { workspaceService } from '@/services/workspace-service';
import type { WorkspaceData } from '@/types/domain';
export function SettingsPage({ data }: { data: WorkspaceData }) {
  const [settings, setSettings] = useState({ ...data.preferences });
  const [error, setError] = useState('');
  const navigate = useWorkbench((s) => s.navigate);
  const density = useWorkbench((s) => s.density);
  const setDensity = useWorkbench((s) => s.setDensity);
  const save = useCommand(
    () => workspaceService.savePreferences(settings),
    'Workspace settings saved.',
  );
  const update = (key: keyof typeof settings, value: string | number | boolean) =>
    setSettings((s) => ({ ...s, [key]: value }));
  return (
    <>
      <PageHeader
        title="Settings"
        description="Fine-tune execution preferences and credential generation."
      />
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (
            !Number.isInteger(settings.concurrency) ||
            settings.concurrency < 1 ||
            settings.concurrency > 16
          ) {
            setError('Concurrent browsers must be between 1 and 16.');
            return;
          }
          if (
            settings.catchallDomain &&
            !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i.test(settings.catchallDomain)
          ) {
            setError('Enter a valid catchall domain without @ or https://.');
            return;
          }
          if (
            !Number.isInteger(settings.usernameLength) ||
            settings.usernameLength < 6 ||
            settings.usernameLength > 32 ||
            settings.usernamePrefix.length >= settings.usernameLength
          ) {
            setError('Username length must be 6-32 and longer than its prefix.');
            return;
          }
          if (!/^[a-zA-Z0-9_]*$/.test(settings.usernamePrefix)) {
            setError('Username prefix may contain letters, numbers and underscores.');
            return;
          }
          if (
            !Number.isInteger(settings.passwordLength) ||
            settings.passwordLength < 12 ||
            settings.passwordLength > 64
          ) {
            setError('Password length must be between 12 and 64.');
            return;
          }
          setError('');
          save.mutate(undefined);
        }}
      >
        <div className="settings-sections">
          <section className="panel settings-panel">
            <div className="panel-heading">
              <div className="icon-heading">
                <span className="resource-icon">
                  <SlidersHorizontal size={20} />
                </span>
                <div>
                  <h2>Execution</h2>
                  <p>Control how your workspace uses browser resources.</p>
                </div>
              </div>
            </div>
            <div className="form-stack">
              <div className="form-grid">
                <Field
                  label="Concurrent browsers"
                  hint="Maximum parallel executions. Actual capacity is enforced by desktop services."
                >
                  {(id) => (
                    <Input
                      id={id}
                      type="number"
                      min={1}
                      max={16}
                      value={settings.concurrency}
                      onChange={(e) => update('concurrency', Number(e.target.value))}
                    />
                  )}
                </Field>
                <Field
                  label="Table density"
                  hint="Applies immediately and is saved on this device."
                >
                  {(id) => (
                    <Select
                      id={id}
                      value={density}
                      onChange={(e) => setDensity(e.target.value as 'compact' | 'comfortable')}
                    >
                      <option value="comfortable">Comfortable</option>
                      <option value="compact">Compact</option>
                    </Select>
                  )}
                </Field>
              </div>
            </div>
          </section>
          <section className="panel settings-panel">
            <div className="panel-heading">
              <div className="icon-heading">
                <span className="resource-icon">
                  <KeyRound size={20} />
                </span>
                <div>
                  <h2>Credential generation</h2>
                  <p>Rules used when desktop services generate new credentials.</p>
                </div>
              </div>
            </div>
            <div className="form-stack">
              <Field
                label="Account Email Domain"
                hint="Generates signup addresses. Configure the separate OTP Inbox in Email integration; forwarding is managed by your domain provider."
              >
                {(id) => (
                  <Input
                    id={id}
                    value={settings.catchallDomain}
                    onChange={(e) => update('catchallDomain', e.target.value.trim())}
                    placeholder="your-domain.com"
                  />
                )}
              </Field>
              <div className="form-grid">
                <Field label="Username prefix">
                  {(id) => (
                    <Input
                      id={id}
                      value={settings.usernamePrefix}
                      maxLength={24}
                      onChange={(e) => update('usernamePrefix', e.target.value)}
                    />
                  )}
                </Field>
                <Field label="Username length">
                  {(id) => (
                    <Input
                      id={id}
                      type="number"
                      min={6}
                      max={32}
                      value={settings.usernameLength}
                      onChange={(e) => update('usernameLength', Number(e.target.value))}
                    />
                  )}
                </Field>
                <Field label="Password length">
                  {(id) => (
                    <Input
                      id={id}
                      type="number"
                      min={12}
                      max={64}
                      value={settings.passwordLength}
                      onChange={(e) => update('passwordLength', Number(e.target.value))}
                    />
                  )}
                </Field>
              </div>
              <fieldset className="checkbox-group">
                <legend>Password characters</legend>
                {[
                  { key: 'uppercase', label: 'Uppercase letters' },
                  { key: 'numbers', label: 'Numbers' },
                  { key: 'symbols', label: 'Special characters' },
                ].map((x) => (
                  <label key={x.key}>
                    <input
                      type="checkbox"
                      checked={settings[x.key as 'uppercase' | 'numbers' | 'symbols']}
                      onChange={(e) => update(x.key as keyof typeof settings, e.target.checked)}
                    />
                    {x.label}
                  </label>
                ))}
              </fieldset>
              <div className="inline-note">
                <ShieldCheck size={17} />
                <span>
                  Passwords are generated in the backend. This page stores policy settings, not
                  account secrets.
                </span>
              </div>
            </div>
          </section>
          <section className="panel settings-panel">
            <div className="panel-heading">
              <div>
                <h2>OTP inbox / Gmail IMAP</h2>
                <p>Saved App Passwords reload automatically in Email integration.</p>
              </div>
            </div>
            <div className="form-stack">
              <p className="small-text">
                {data.email.configured ? data.email.address : 'No OTP inbox configured.'}
              </p>
              <p className="small-text muted">
                View or update your saved App Password using Show / Hide Password. Credentials
                remain encrypted in the local backend.
              </p>
              <Button onClick={() => navigate('email')}>Manage OTP inbox</Button>
            </div>
          </section>
          <section className="panel about-panel">
            <Monitor size={24} />
            <div>
              <strong>WeCode Desktop</strong>
              <p>Version {appVersion}</p>
              <p className="small-text muted">Built {appBuildTime}</p>
            </div>
            <span className="protocol">Desktop</span>
          </section>
        </div>
        {error && (
          <p className="form-error settings-error" role="alert">
            {error}
          </p>
        )}
        <div className="settings-save">
          <Button variant="default" type="submit" disabled={save.isPending}>
            <Save size={16} />
            {save.isPending ? 'Saving...' : 'Save settings'}
          </Button>
        </div>
      </form>
    </>
  );
}
