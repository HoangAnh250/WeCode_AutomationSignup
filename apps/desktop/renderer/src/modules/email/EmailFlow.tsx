import { ArrowRight, Mail, Globe, Inbox, KeyRound } from 'lucide-react';
export function exampleAccountEmail(domain: string) {
  if (!/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(domain)) return '';
  const values = crypto.getRandomValues(new Uint32Array(12));
  const letters = Array.from(values.slice(0, 8), (n) => String.fromCharCode(97 + (n % 26))).join(
    '',
  );
  const digits = Array.from(values.slice(8), (n) => String(n % 10)).join('');
  return `${letters}${digits}@${domain.toLowerCase()}`;
}
export function EmailFlow({ accountEmail, inbox }: { accountEmail: string; inbox: string }) {
  const steps = [
    {
      title: 'Generated Account Email',
      value: accountEmail || 'Configure an account domain',
      icon: Mail,
    },
    { title: 'Verification email sent', value: 'To the generated account email', icon: Mail },
    { title: 'Catch-all forwarding', value: 'Configured at your domain provider', icon: Globe },
    { title: 'OTP Inbox', value: inbox || 'Configure the Gmail inbox', icon: Inbox },
    { title: 'IMAP OTP extraction', value: 'Match the original account recipient', icon: KeyRound },
  ];
  return (
    <section className="panel settings-panel">
      <div className="panel-heading">
        <h2>Email verification workflow</h2>
      </div>
      <ol className="email-flow" aria-label="Email verification workflow">
        {steps.map((step, i) => (
          <li key={step.title}>
            <span className="resource-icon">
              <step.icon size={18} />
            </span>
            <div>
              <strong>{step.title}</strong>
              <p>{step.value}</p>
            </div>
            {i < steps.length - 1 && <ArrowRight size={16} aria-hidden="true" />}
          </li>
        ))}
      </ol>
      <p className="page-footnote">
        Gmail is only the receiving inbox. It is never the generated signup identity. Connecting
        IMAP does not configure or prove catch-all forwarding.
      </p>
    </section>
  );
}
