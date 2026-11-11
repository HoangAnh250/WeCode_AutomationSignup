import type { Locator, Page } from 'playwright';
import { setTimeout as delay } from 'node:timers/promises';
import type { BrowserWorkflowContext } from '../contracts.js';
import { AppError } from '../../core/errors.js';
import type { Term } from './protocol.js';
export class WeversePage {
  constructor(
    private readonly ctx: BrowserWorkflowContext,
    private readonly accountOrigin: string,
  ) {}
  private get page(): Page {
    return this.ctx.page;
  }
  private async check() {
    await this.ctx.execution.assertCanContinue();
    if (new URL(this.page.url()).origin !== this.accountOrigin)
      throw new AppError(
        'WEVERSE_UNEXPECTED_ORIGIN',
        'The signup page left the expected account origin.',
        422,
      );
  }
  private async one(candidates: Locator[], field: string, timeout = 15000) {
    const until = Date.now() + timeout;
    while (Date.now() < until) {
      await this.check();
      for (const candidate of candidates) {
        const visible = candidate.filter({ visible: true });
        const count = await visible.count();
        if (count > 1)
          throw new AppError(
            'WEVERSE_SELECTOR_AMBIGUOUS',
            `Multiple controls matched the ${field} field.`,
            422,
          );
        if (count === 1) return visible;
      }
      await delay(100, undefined, { signal: this.ctx.signal });
    }
    throw new AppError(
      'WEVERSE_SELECTOR_CHANGED',
      `The ${field} control was not found in the signup page.`,
      422,
    );
  }
  async open(url: string) {
    await this.ctx.execution.assertCanContinue();
    const response = await this.page.goto(url, { waitUntil: 'domcontentloaded' });
    if (response && !response.ok())
      throw new AppError(
        'WEVERSE_PAGE_UNAVAILABLE',
        'The signup page could not be loaded.',
        502,
        true,
      );
    await this.check();
    const entry = this.page
      .getByRole('button', { name: /^Sign up with email$/i })
      .or(this.page.getByRole('link', { name: /^Sign up with email$/i }));
    // A fresh cookie-consent decision can route back to /login before signup entry.
    const refuse = this.page.getByRole('button', { name: /^Refuse and continue$/i });
    const signup = this.page.getByRole('button', { name: /^Sign Up$/i });
    for (let transition = 0; transition < 4; transition++) {
      if (new URL(this.page.url()).pathname.endsWith('/signup/credential')) return;
      const control = await this.one([refuse, entry, signup], 'email signup entry');
      const label = (await control.textContent())?.trim() ?? '';
      await control.click();
      if (/^Sign up with email$/i.test(label)) {
        await this.page.waitForURL(
          (url) => url.origin === this.accountOrigin && url.pathname.endsWith('/signup/credential'),
          { timeout: 15000 },
        );
        return;
      }
      if (/^Sign Up$/i.test(label))
        await this.page.waitForURL(
          (url) => url.origin === this.accountOrigin && url.pathname.endsWith('/signup'),
          { timeout: 15000 },
        );
    }
    throw new AppError(
      'WEVERSE_SELECTOR_CHANGED',
      'The email signup entry could not be reached.',
      422,
    );
  }

  async fillIdentity(identity: { email: string; username: string; password: string }) {
    const email = await this.one(
      [
        this.page.getByLabel(/^Email(?:\s*required)?$/i),
        this.page.getByPlaceholder('your@email.com', { exact: true }),
        this.page.locator('input[type="email"]'),
      ],
      'email',
    );
    await email.fill(identity.email);
    await (
      await this.one(
        [
          this.page.getByLabel(/^Password(?:\s*required)?$/i),
          this.page.getByPlaceholder('Password', { exact: true }),
          this.page.locator('input[name="password"]'),
        ],
        'password',
      )
    ).fill(identity.password);
    await (
      await this.one(
        [
          this.page.getByLabel(/^Confirm (?:new )?password(?:\s*required)?$/i),
          this.page.getByPlaceholder(/^Confirm (?:new )?password$/i),
        ],
        'password confirmation',
      )
    ).fill(identity.password);
    await (
      await this.one(
        [
          this.page.getByLabel(/^(?:Username|Nickname)(?:\s*required)?$/i),
          this.page.getByPlaceholder('Enter Nickname', { exact: true }),
        ],
        'username',
      )
    ).fill(identity.username);
  }
  async disableOverseasBlock() {
    const control = await this.one(
      [
        this.page.getByRole('checkbox', { name: /^Block Overseas Logins$/i }),
        this.page.getByRole('switch', { name: /^Block Overseas Logins$/i }),
      ],
      'Block Overseas Logins',
    );
    await control.setChecked(false);
    if (await control.isChecked())
      throw new AppError(
        'WEVERSE_OVERSEAS_BLOCK_ENABLED',
        'Block Overseas Logins must be disabled before signup.',
        422,
      );
  }
  async sendOtp() {
    await (
      await this.one(
        [this.page.getByRole('button', { name: /^Send Verification Code$/i })],
        'send verification code',
      )
    ).click();
  }
  async verifyOtp(code: string) {
    await (
      await this.one(
        [
          this.page.getByLabel(/^Verification Code(?:\s*required)?$/i),
          this.page.getByPlaceholder('6-digit Verification Code', { exact: true }),
          this.page.locator('input[autocomplete="one-time-code"]'),
        ],
        'verification code',
      )
    ).fill(code);
    await (
      await this.one([this.page.getByRole('button', { name: /^Verify Code$/i })], 'verify code')
    ).click();
  }
  async timeZone(zone: string) {
    const control = await this.one([this.page.getByRole('combobox')], 'timezone');
    if ((await control.evaluate((element) => element.tagName.toLowerCase())) === 'select')
      await control.selectOption(zone);
    else {
      await control.click();
      const escaped = zone.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      await (
        await this.one(
          [this.page.getByRole('option', { name: new RegExp(escaped, 'i') })],
          'timezone option',
        )
      ).click();
    }
  }
  async next() {
    await (await this.one([this.page.getByRole('button', { name: /^Next$/i })], 'next')).click();
  }
  async consent(terms: Term[]) {
    if (!terms.length)
      throw new AppError('WEVERSE_TERMS_CHANGED', 'Signup terms were not loaded.', 422);
    // Child terms can be collapsed. Use the site's aggregate control so its own
    // consent model updates every current document, including grouped terms.
    const all = await this.one(
      [
        this.page.getByRole('checkbox', { name: /^\s*Agree to All\s*$/i }),
        this.page.getByLabel(/^\s*Agree to All\s*$/i),
      ],
      'Agree to All',
    );
    await all.setChecked(true);
    if (!(await all.isChecked()))
      throw new AppError('WEVERSE_CONSENT_NOT_SELECTED', 'Agree to All was not selected.', 422);
  }
  async submit() {
    await (
      await this.one([this.page.getByRole('button', { name: /^Sign up now$/i })], 'signup submit')
    ).click();
  }
  async complete() {
    const confirm = this.page.getByRole('button', { name: /^Confirm$/i });
    const start = this.page.getByRole('button', { name: /^Start$/i });
    const button = await this.one([confirm, start], 'completion', 3000);
    if (/^Confirm$/i.test((await button.textContent())?.trim() ?? '')) {
      await button.click();
      await (await this.one([start], 'start', 3000)).click();
    } else await button.click();
  }
}
