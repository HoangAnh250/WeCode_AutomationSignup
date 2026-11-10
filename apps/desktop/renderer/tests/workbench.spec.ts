import { test, expect } from '@playwright/test';
async function navigate(page: import('@playwright/test').Page, name: string) {
  await page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('button', { name, exact: true })
    .click();
}
test('all eight pages render without browser errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Workspace overview' })).toBeVisible();
  for (const [nav, title] of [
    ['Tasks', 'Tasks'],
    ['Proxies', 'Proxies'],
    ['Browser profiles', 'Browser profiles'],
    ['Accounts', 'Accounts'],
    ['Email integration', 'Email integration'],
    ['Logs', 'Logs'],
  ] as const) {
    await navigate(page, nav);
    await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
  }
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});
test('task create, edit, start, pause, resume and delete', async ({ page }) => {
  await page.goto('/');
  await navigate(page, 'Tasks');
  await page.getByRole('button', { name: 'Create task', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Task name').fill('Integration workflow');
  await dialog.getByRole('button', { name: 'Create task', exact: true }).click();
  let row = page.getByRole('row').filter({ hasText: 'Integration workflow' });
  await expect(row).toBeVisible();
  await row.getByRole('button', { name: 'Edit Integration workflow', exact: true }).click();
  await dialog.getByLabel('Task name').fill('Updated workflow');
  await dialog.getByRole('button', { name: 'Save changes' }).click();
  row = page.getByRole('row').filter({ hasText: 'Updated workflow' });
  await row.getByRole('button', { name: 'start Updated workflow', exact: true }).click();
  await expect(row.getByText('running', { exact: true })).toBeVisible();
  await expect(row.getByRole('button', { name: 'Delete Updated workflow' })).toBeDisabled();
  await row.getByRole('button', { name: 'pause Updated workflow', exact: true }).click();
  await expect(row.getByText('paused', { exact: true })).toBeVisible();
  await row.getByRole('button', { name: 'resume Updated workflow', exact: true }).click();
  await expect(row.getByText('running', { exact: true })).toBeVisible();
  await row.getByRole('button', { name: 'pause Updated workflow', exact: true }).click();
  await expect(row.getByText('paused', { exact: true })).toBeVisible();
  await row.getByRole('button', { name: 'Delete Updated workflow' }).click();
  await dialog.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(row).toHaveCount(0);
});
test('TXT proxy import validates errors and duplicates without leaking passwords', async ({
  page,
}) => {
  await page.goto('/');
  await navigate(page, 'Proxies');
  await page.getByRole('button', { name: 'Import proxies' }).click();
  const dialog = page.getByRole('dialog');
  await dialog
    .getByLabel('Proxy entries')
    .fill('proxy.test:8080\nproxy.test:8080\nbad-line\nsocks5://user:secret123@proxy2.test:1080');
  await dialog.getByRole('button', { name: 'Validate list' }).click();
  await expect(dialog.getByText(/2 valid.*1 invalid.*1 duplicates/)).toBeVisible();
  await dialog.getByRole('button', { name: 'Import valid proxies' }).click();
  await page.getByRole('textbox', { name: 'Search', exact: true }).fill('proxy2.test');
  await expect(page.getByRole('table')).toContainText('proxy2.test:1080');
  await expect(page.getByRole('table')).not.toContainText('secret123');
});
test('JSON file import is supported', async ({ page }) => {
  await page.goto('/');
  await navigate(page, 'Proxies');
  await page.getByRole('button', { name: 'Import proxies' }).click();
  await page.getByLabel('Proxy import file').setInputFiles({
    name: 'proxies.json',
    mimeType: 'application/json',
    buffer: Buffer.from(
      JSON.stringify([{ host: 'json.proxy.test', port: 3128, protocol: 'https' }]),
    ),
  });
  await expect(page.getByLabel('Proxy entries')).toHaveValue(/json.proxy.test/);
  await page.getByRole('button', { name: 'Validate list' }).click();
  await expect(page.getByText(/1 valid.*0 invalid/)).toBeVisible();
  await page.getByRole('button', { name: 'Import valid proxies' }).click();
  await page.getByRole('textbox', { name: 'Search', exact: true }).fill('json.proxy.test');
  await expect(page.getByRole('table')).toContainText('json.proxy.test');
});
test('account search, verification filter and filtered CSV export', async ({ page }) => {
  await page.goto('/');
  await navigate(page, 'Accounts');
  await page.getByLabel('Verification filter').selectOption('pending');
  await expect(page.getByRole('table').locator('tbody tr')).toHaveCount(1);
  await page.getByRole('textbox', { name: 'Search', exact: true }).fill('member.006');
  await expect(page.getByRole('table')).toContainText('member.006@example.test');
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export CSV', exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('wecode-accounts.csv');
  const path = await download.path();
  const { readFile } = await import('node:fs/promises');
  const text = await readFile(path!, 'utf8');
  expect(text).toContain('member.006@example.test');
  expect(text).toContain('"Password"');
  expect(text).toContain('PreviewOnly!000006aB');
  expect(text).not.toContain('PreviewOnly!000001aB');
  expect(text).not.toContain('member.001@example.test');
  expect(text).toContain('\r\n');
  expect(text.charCodeAt(0)).toBe(0xfeff);
});
test('mailbox password is cleared and never persisted', async ({ page }) => {
  await page.goto('/');
  await navigate(page, 'Email integration');
  const password = page.getByLabel('App Password', { exact: true });
  await password.fill('abcd efgh ijkl mnop');
  await page.getByRole('button', { name: 'Save connection' }).click();
  await expect(password).toHaveValue('');
  const stored = await page.evaluate(() => JSON.stringify({ ...localStorage }));
  expect(stored).not.toContain('abcd');
  await page.getByRole('button', { name: 'Test connection' }).click();
  await expect(page.getByText(/Preview does not connect to Gmail/)).toBeVisible();
});
test('profile creation and deletion respect running state', async ({ page }) => {
  await page.goto('/');
  await navigate(page, 'Browser profiles');
  await expect(page.getByRole('button', { name: 'Delete profile Workspace 01' })).toBeDisabled();
  await page.getByRole('button', { name: 'Create profile', exact: true }).click();
  await page.getByLabel('Profile name').fill('QA isolated profile');
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Create profile', exact: true })
    .click();
  await expect(page.getByRole('heading', { name: 'QA isolated profile' })).toBeVisible();
  await page.getByRole('button', { name: 'Delete profile QA isolated profile' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'QA isolated profile' })).toHaveCount(0);
});
test('logs support text, level and category filtering', async ({ page }) => {
  await page.goto('/');
  await navigate(page, 'Logs');
  await page.getByLabel('Log level').selectOption('error');
  await expect(page.getByRole('listitem')).toHaveCount(1);
  await page.getByRole('textbox', { name: 'Search', exact: true }).fill('verification timeout');
  await expect(page.getByRole('listitem')).toContainText('TSK-1005');
  await page.getByRole('listitem').getByRole('button').click();
  await expect(page.getByRole('dialog')).toContainText('verification timeout');
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await page.getByLabel('Log category').selectOption('browser');
  await expect(page.getByText('No matching events')).toBeVisible();
});
test('settings validate cross-field policy constraints', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByLabel('Username prefix').fill('prefix_too_long');
  await page.getByRole('button', { name: 'Save settings' }).click();
  await expect(page.getByRole('alert')).toContainText('longer than its prefix');
  await page.getByLabel('Username prefix').fill('qa');
  await page.getByLabel('Account Email Domain').fill('qa.example.test');
  await page.getByRole('button', { name: 'Save settings' }).click();
  await expect(page.getByText('Workspace settings saved.', { exact: true })).toBeVisible();
});
test('keyboard command palette and Escape work', async ({ page }) => {
  await page.goto('/');
  await page.keyboard.press('Control+k');
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByLabel('Find a page').fill('Accounts');
  await page.getByRole('dialog').getByRole('button', { name: 'Accounts' }).click();
  await expect(page.getByRole('heading', { name: 'Accounts', exact: true })).toBeVisible();
  await page.keyboard.press('Control+k');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});
test('missing IPC does not silently return sample data', async ({ page }) => {
  await page.goto('/?preview=off');
  await expect(
    page.getByRole('heading', { name: 'Desktop services are unavailable' }),
  ).toBeVisible();
  await expect(page.getByText('Frontend preview', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Weekly account onboarding', { exact: true })).toHaveCount(0);
});
test('desktop and compact layouts have no document overflow', async ({ page }) => {
  for (const width of [1440, 1024, 800, 600]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Workspace overview' })).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Workspace overview' })).toBeVisible();
  await expect(page.getByLabel('Loading workspace')).toHaveCount(0);
  await page.screenshot({ path: 'test-results/dashboard-desktop.png', fullPage: true });
});

test('preload bridge is used instead of preview and command errors surface', async ({ page }) => {
  await page.addInitScript(() => {
    const unavailable = async () => {
      throw new Error('Desktop rejected the command for this workspace.');
    };
    window.wecode = {
      protocolVersion: 1,
      client: {
        getWorkspace: async () => ({
          tasks: [],
          proxies: [],
          profiles: [],
          accounts: [
            {
              id: 'export-account',
              email: 'fixture@example.test',
              username: 'fixture',
              proxy: 'direct',
              createdAt: '2026-01-01T00:00:00Z',
              verification: 'verified',
            },
          ],
          email: { address: '', configured: false, status: 'unknown' },
          preferences: {
            concurrency: 2,
            catchallDomain: 'example.test',
            usernamePrefix: 'qa',
            usernameLength: 12,
            passwordLength: 20,
            uppercase: true,
            numbers: true,
            symbols: true,
          },
        }),
        createTask: unavailable,
        updateTask: unavailable,
        deleteTask: unavailable,
        taskAction: unavailable,
        importProxies: unavailable,
        checkProxy: unavailable,
        createProfile: unavailable,
        deleteProfile: unavailable,
        saveEmail: unavailable,
        testEmail: unavailable,
        getEmailVerifications: async () => [],
        savePreferences: unavailable,
        getLogs: async () => [],
        exportAccounts: async (ids, options) => {
          document.documentElement.dataset.exportRequest = JSON.stringify({ ids, options });
        },
        exportLogs: unavailable,
        subscribe: () => () => {},
      },
    };
  });
  await page.goto('/');
  await expect(page.getByText('Desktop bridge', { exact: true })).toBeVisible();
  await expect(page.getByText('Frontend preview', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'No tasks running' })).toBeVisible();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Save settings' }).click();
  await expect(page.getByText('Desktop rejected the command for this workspace.')).toBeVisible();
  await navigate(page, 'Accounts');
  await page.getByRole('button', { name: 'Export CSV', exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => document.documentElement.dataset.exportRequest))
    .toBe(JSON.stringify({ ids: ['export-account'], options: { includePasswords: true } }));
});
test('log export includes only the current filter', async ({ page }) => {
  await page.goto('/');
  await navigate(page, 'Logs');
  await page.getByLabel('Log level').selectOption('error');
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export logs' }).click();
  const download = await pending;
  const { readFile } = await import('node:fs/promises');
  const text = await readFile((await download.path())!, 'utf8');
  expect(text).toContain('verification timeout');
  expect(text).not.toContain('Workspace initialized');
});

test('account domain and OTP inbox stay separate with preview and forwarding flow', async ({
  page,
}) => {
  await page.goto('/');
  await navigate(page, 'Email integration');
  await page.getByLabel('Account Email Domain', { exact: true }).fill('mytic.website');
  await expect(page.getByLabel('Generated Email Preview', { exact: true })).toHaveValue(
    /^[a-z0-9]+@mytic\.website$/,
  );
  await page.getByLabel('Gmail address', { exact: true }).fill('alo123@gmail.com');
  await page.getByText('Advanced IMAP settings', { exact: true }).click();
  await expect(page.getByLabel('IMAP host', { exact: true })).toHaveValue('imap.gmail.com');
  await expect(page.getByLabel('IMAP port', { exact: true })).toHaveValue('993');
  await page.getByLabel('IMAP folder', { exact: true }).fill('Verification');
  await page.getByLabel('App Password', { exact: true }).fill('abcd efgh ijkl mnop');
  await page.getByRole('button', { name: 'Save connection', exact: true }).click();
  await expect(page.getByLabel('App Password', { exact: true })).toHaveValue('');
  await expect(page.getByRole('list', { name: 'Email verification workflow' })).toContainText(
    'alo123@gmail.com',
  );
  await expect(page.getByRole('list', { name: 'Email verification workflow' })).toContainText(
    'Catch-all forwarding',
  );
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByLabel('Account Email Domain', { exact: true })).toHaveValue(
    'mytic.website',
  );
  await navigate(page, 'Email integration');
  await expect(page.getByLabel('Gmail address', { exact: true })).toHaveValue('alo123@gmail.com');
  await expect(page.getByLabel('Generated Email Preview', { exact: true })).not.toHaveValue(
    'alo123@gmail.com',
  );
  await page.getByText('Advanced IMAP settings', { exact: true }).click();
  await expect(page.getByLabel('IMAP folder', { exact: true })).toHaveValue('Verification');
  await page.screenshot({ path: 'test-results/email-integration-audit.png', fullPage: true });
});

test('new tasks default to Local without a proxy even when the pool has entries', async ({
  page,
}) => {
  await page.goto('/');
  await navigate(page, 'Tasks');
  await page.getByRole('button', { name: 'Create task', exact: true }).click();
  await expect(page.getByLabel('Proxy assignment', { exact: true })).toHaveValue(
    'Local (no proxy)',
  );
  await page.getByLabel('Task name', { exact: true }).fill('Local connection task');
  await page.getByRole('dialog').getByRole('button', { name: 'Create task', exact: true }).click();
  await expect(page.getByRole('row').filter({ hasText: 'Local connection task' })).toContainText(
    'Local (no proxy)',
  );
  await page.getByRole('button', { name: 'Edit Local connection task', exact: true }).click();
  await expect(page.getByLabel('Proxy assignment', { exact: true })).toHaveValue(
    'Local (no proxy)',
  );
  await expect(page.getByRole('option', { name: 'Local (no proxy)', exact: true })).toHaveCount(1);
});

test('failed preview tasks expose Retry and requeue on manual request', async ({ page }) => {
  await page.goto('/');
  await navigate(page, 'Tasks');
  await page.getByLabel('Filter task status').selectOption('failed');
  const retry = page.getByRole('button', { name: 'retry Account recovery checks', exact: true });
  await expect(retry).toBeEnabled();
  await retry.click();
  await page.getByLabel('Filter task status').selectOption('all');
  await expect(page.getByRole('row').filter({ hasText: 'Account recovery checks' })).toContainText(
    'pending',
  );
});
