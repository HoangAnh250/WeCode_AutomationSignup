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
test('saved mailbox password reloads masked and can be shown without browser persistence', async ({
  page,
}) => {
  await page.goto('/');
  await navigate(page, 'Email integration');
  const password = page.getByLabel('App Password', { exact: true });
  await password.fill('abcd efgh ijkl mnop');
  await page.getByRole('button', { name: 'Save connection' }).click();
  await expect(password).toHaveValue('abcd efgh ijkl mnop');
  await expect(password).toHaveAttribute('type', 'password');
  await page.getByRole('button', { name: 'Show App Password' }).click();
  await expect(password).toHaveAttribute('type', 'text');
  await page.getByRole('button', { name: 'Hide App Password' }).click();
  await expect(password).toHaveAttribute('type', 'password');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Manage OTP inbox' }).click();
  await expect(password).toHaveValue('abcd efgh ijkl mnop');
  await expect(password).toHaveAttribute('type', 'password');
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
        updateProxy: unavailable,
        deleteProxy: unavailable,
        createProfile: unavailable,
        deleteProfile: unavailable,
        saveEmail: unavailable,
        testEmail: unavailable,
        getEmailAppPassword: async () => '',
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
  await expect(page.getByLabel('App Password', { exact: true })).toHaveValue('abcd efgh ijkl mnop');
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

test('batch size ten creates ten separate rows and Start all starts only the selected batch', async ({
  page,
}) => {
  await page.goto('/');
  await navigate(page, 'Tasks');
  await page.getByRole('button', { name: 'Create task', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Task name').fill('Ten accounts');
  await dialog.getByLabel('Batch size', { exact: true }).fill('10');
  await expect(dialog.getByLabel('Browser profile')).toBeDisabled();
  await dialog.getByRole('button', { name: 'Create task', exact: true }).click();
  const table = page.getByRole('table', { name: 'Automation tasks' });
  await expect(table.locator('tbody tr')).toHaveCount(10);
  await expect(table.getByText('Ten accounts [01/10]', { exact: true })).toBeVisible();
  await expect(table.getByText('Ten accounts [10/10]', { exact: true })).toBeVisible();
  await expect(table.getByText('draft', { exact: true })).toHaveCount(10);
  await page.screenshot({ path: 'test-results/batch-ten-rows.png', fullPage: true });
  await page.getByRole('button', { name: 'Start all (10)', exact: true }).click();
  await expect(table.getByText('running', { exact: true })).toHaveCount(10);
  await expect(page.getByRole('button', { name: 'Start all (0)', exact: true })).toBeDisabled();
  await page.getByLabel('Filter task batch').selectOption('');
  await expect(table.locator('tbody tr').filter({ hasText: 'Ten accounts [' })).toHaveCount(10);
});

test('success task can start again without deleting saved accounts', async ({ page }) => {
  await page.goto('/');
  await navigate(page, 'Accounts');
  await expect(page.getByRole('table').locator('tbody tr')).toHaveCount(8);
  const count = await page.getByRole('table').locator('tbody tr').count();
  await navigate(page, 'Tasks');
  const row = page.getByRole('row').filter({ hasText: 'Email verification batch' });
  await row.getByRole('button', { name: 'start Email verification batch', exact: true }).click();
  await expect(row.getByText('running', { exact: true })).toBeVisible();
  await expect(row.getByRole('progressbar')).toHaveAttribute('value', '0');
  await navigate(page, 'Accounts');
  await expect(page.getByRole('table').locator('tbody tr')).toHaveCount(count);
});

test('range selection works across pages, bulk edit preserves names and delete keeps active rows', async ({
  page,
}) => {
  await page.goto('/');
  await navigate(page, 'Tasks');
  await page.getByRole('button', { name: 'Create task', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Task name').fill('Bulk selection');
  await dialog.getByLabel('Batch size').fill('30');
  await dialog.getByRole('button', { name: 'Create task', exact: true }).click();
  await expect(page.getByRole('table').locator('tbody tr')).toHaveCount(25);
  await page.getByLabel('From row', { exact: true }).fill('24');
  await page.getByLabel('To row', { exact: true }).fill('28');
  await page.getByRole('button', { name: 'Select range', exact: true }).click();
  await expect(page.getByText('5 selected', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Next page' }).click();
  await expect(
    page.getByRole('checkbox', { name: 'Select Bulk selection [26/30]', exact: true }),
  ).toBeChecked();
  await expect(
    page.getByRole('checkbox', { name: 'Select Bulk selection [28/30]', exact: true }),
  ).toBeChecked();
  await expect(
    page.getByRole('checkbox', { name: 'Select Bulk selection [29/30]', exact: true }),
  ).not.toBeChecked();
  await page.getByRole('button', { name: 'Edit selected', exact: true }).click();
  await dialog.getByLabel('Proxy', { exact: true }).selectOption('Local (no proxy)');
  await dialog.getByLabel('Browser visibility').selectOption('hide');
  await dialog.getByRole('button', { name: 'Save 5 tasks', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole('row').filter({ hasText: 'Bulk selection [26/30]' })).toContainText(
    'Local (no proxy)',
  );
  await page.getByLabel('From row', { exact: true }).fill('29');
  await page.getByLabel('To row', { exact: true }).fill('99');
  await page.getByRole('button', { name: 'Select range', exact: true }).click();
  await expect(page.getByText(/Enter a row range/)).toBeVisible();
  await page.getByLabel('From row', { exact: true }).fill('24');
  await page.getByLabel('To row', { exact: true }).fill('28');
  await page.getByRole('button', { name: 'Select range', exact: true }).click();
  await page.getByRole('button', { name: 'Delete selected', exact: true }).click();
  await dialog.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.getByText('Showing 1-25 of 25 records')).toBeVisible();
  await page.getByRole('button', { name: 'Delete all tasks', exact: true }).click();
  await expect(dialog).toContainText('entire workspace');
  await dialog.getByRole('button', { name: 'Delete', exact: true }).click();
  await page.getByLabel('Filter task batch').selectOption('');
  await expect(page.getByRole('table').locator('tbody tr')).toHaveCount(3);
  await expect(page.getByRole('table')).toContainText('Weekly account onboarding');
});

test('proxy single edit preserves credentials by default and supports explicit replacement', async ({
  page,
}) => {
  await page.goto('/');
  await navigate(page, 'Proxies');
  const row = page.getByRole('row').filter({ hasText: '192.0.2.12:8002' });
  await row.getByRole('button', { name: 'Edit 192.0.2.12:8002', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel('Authentication', { exact: true })).toHaveValue('keep');
  await dialog.getByLabel('Hostname', { exact: true }).fill('updated.proxy.test');
  await dialog.getByLabel('Authentication', { exact: true }).selectOption('replace');
  await dialog.getByLabel('Proxy username', { exact: true }).fill('fixture-user');
  await dialog.getByLabel('Proxy password', { exact: true }).fill('Fixture-Only!Secret');
  await dialog.getByRole('button', { name: 'Save proxy', exact: true }).click();
  await expect(page.getByRole('table')).toContainText('updated.proxy.test:8002');
  await expect(page.getByRole('table')).not.toContainText('Fixture-Only!Secret');
  const updated = page.getByRole('row').filter({ hasText: 'updated.proxy.test:8002' });
  await expect(updated).toContainText('Authenticated');
  await updated
    .getByRole('button', { name: 'Delete updated.proxy.test:8002', exact: true })
    .click();
  await dialog.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(updated).toHaveCount(0);
  const active = page.getByRole('row').filter({ hasText: '192.0.2.10:8000' });
  await expect(
    active.getByRole('button', { name: 'Delete 192.0.2.10:8000', exact: true }),
  ).toBeDisabled();
});
test('proxy numbered pagination supports cross-page selection, bulk edit and filtered bulk delete', async ({
  page,
}) => {
  await page.goto('/');
  await navigate(page, 'Proxies');
  await page.getByRole('button', { name: 'Import proxies', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog
    .getByLabel('Proxy entries')
    .fill(
      Array.from(
        { length: 30 },
        (_, i) => `pageproxy-${String(i + 1).padStart(3, '0')}.test:8080`,
      ).join('\n'),
    );
  await dialog.getByRole('button', { name: 'Validate list', exact: true }).click();
  await dialog.getByRole('button', { name: 'Import valid proxies', exact: true }).click();
  await page.getByRole('textbox', { name: 'Search', exact: true }).fill('pageproxy-');
  await expect(page.getByRole('table').locator('tbody tr')).toHaveCount(10);
  await page.getByRole('checkbox', { name: 'Select pageproxy-001.test:8080', exact: true }).check();
  await page.getByRole('button', { name: 'Go to page 3', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Go to page 3', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await page.getByRole('checkbox', { name: 'Select pageproxy-021.test:8080', exact: true }).check();
  await expect(page.getByText('2 selected', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Edit selected', exact: true }).click();
  await expect(dialog.getByLabel('Hostname', { exact: true })).toHaveCount(0);
  await dialog.getByLabel('Port', { exact: true }).fill('8123');
  await dialog.getByRole('button', { name: 'Save 2 proxies', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole('table')).toContainText('pageproxy-021.test:8123');
  await page.getByRole('button', { name: 'Go to page 1', exact: true }).click();
  await expect(page.getByRole('table')).toContainText('pageproxy-001.test:8123');
  await page.getByRole('checkbox', { name: 'Select all filtered proxies', exact: true }).check();
  await expect(page.getByText('30 selected', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Delete selected', exact: true }).click();
  await dialog.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.getByText('No matching records', { exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: 'Search', exact: true }).fill('');
  await page.getByLabel('Proxies per page', { exact: true }).selectOption('25');
  await expect(page.getByRole('table').locator('tbody tr')).toHaveCount(8);
});

test('Start all can be used again after successful completion and skips ineligible tasks', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const tasks = [
      { id: 'success-a', name: 'Completed A', status: 'success', allowedActions: ['start'] },
      { id: 'success-b', name: 'Completed B', status: 'success', allowedActions: ['start'] },
      { id: 'draft-c', name: 'New C', status: 'draft', allowedActions: ['start'] },
      { id: 'running-d', name: 'Running D', status: 'running', allowedActions: ['pause'] },
      { id: 'failed-e', name: 'Failed E', status: 'failed', allowedActions: [] },
      { id: 'unknown-f', name: 'Review F', status: 'needs_reconciliation', allowedActions: [] },
    ].map((task) => ({
      ...task,
      workflow: 'Weverse Signup',
      total: 1,
      completed: task.status === 'success' ? 1 : 0,
      progress: task.status === 'success' ? 100 : 0,
      proxy: 'Local (no proxy)',
      profile: 'Auto assign',
      duration: '-',
      retries: 0,
      revision: 1,
    }));
    const listeners = new Set<(event: unknown) => void>();
    const calls: { id: string; revision: number }[] = [];
    const eligible = ['success-a', 'success-b', 'draft-c'];
    const client = {
      getWorkspace: async () =>
        structuredClone({
          tasks,
          proxies: [],
          profiles: [],
          accounts: [],
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
      getLogs: async () => [],
      taskAction: async (id: string, action: string, revision: number) => {
        const task = tasks.find((task) => task.id === id)!;
        if (
          action !== 'start' ||
          !task.allowedActions.includes('start') ||
          revision !== task.revision
        )
          throw new Error('Invalid or stale start.');
        calls.push({ id, revision });
        task.status = 'pending';
        task.allowedActions = ['pause'];
        task.revision++;
      },
      subscribe: (listener: (event: unknown) => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    } as Record<string, unknown>;
    for (const method of [
      'createTask',
      'updateTask',
      'deleteTask',
      'importProxies',
      'checkProxy',
      'updateProxy',
      'deleteProxy',
      'createProfile',
      'deleteProfile',
      'saveEmail',
      'testEmail',
      'savePreferences',
      'exportAccounts',
      'exportLogs',
    ])
      client[method] = async () => {};
    window.wecode = { protocolVersion: 1, client: client as never };
    (window as any).__cycles = {
      calls,
      complete: () => {
        for (const task of tasks.filter((task) => eligible.includes(task.id))) {
          task.status = 'success';
          task.allowedActions = ['start'];
          task.revision++;
        }
        for (const listener of listeners) listener({ type: 'data.changed' });
      },
    };
  });
  await page.goto('/');
  await navigate(page, 'Tasks');
  await page.getByRole('button', { name: 'Start all (3)', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Start all (0)', exact: true })).toBeDisabled();
  let calls = await page.evaluate(() => (window as any).__cycles.calls);
  expect(calls.map((call: any) => call.id).sort()).toEqual(['draft-c', 'success-a', 'success-b']);
  await page.evaluate(() => (window as any).__cycles.complete());
  await expect(page.getByRole('button', { name: 'Start all (3)', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Start all (3)', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Start all (0)', exact: true })).toBeDisabled();
  calls = await page.evaluate(() => (window as any).__cycles.calls);
  expect(calls).toHaveLength(6);
  expect(
    calls
      .slice(3)
      .map((call: any) => call.id)
      .sort(),
  ).toEqual(['draft-c', 'success-a', 'success-b']);
  expect(calls.slice(3).every((call: any) => call.revision === 3)).toBe(true);
  await expect(page.getByRole('row').filter({ hasText: 'Failed E' })).toContainText('failed');
  await expect(page.getByRole('row').filter({ hasText: 'Review F' })).toContainText(
    'needs reconciliation',
  );
});
