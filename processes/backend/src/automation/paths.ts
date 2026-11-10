import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import type { Config } from '../core/config.js';
export function automationDataDirectory(config: Config) {
  return resolve(
    config.BROWSER_DATA_DIR ??
      join(
        process.env.LOCALAPPDATA ?? join(homedir(), '.local', 'share'),
        'WeCode',
        'automation',
        config.INSTALLATION_ID,
      ),
  );
}
