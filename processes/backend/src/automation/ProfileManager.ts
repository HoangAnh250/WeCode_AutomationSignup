import { mkdir, lstat, realpath } from 'node:fs/promises';
import { resolve, join, sep } from 'node:path';
import type { ProfileRepository } from './repositories/profile.repository.js';
import type { LeaseOwner, ProfileLease } from './contracts.js';
import { AppError } from '../core/errors.js';
import { idSchema } from '../contracts/schemas.js';
export class ProfileManager {
  constructor(
    readonly repository: ProfileRepository,
    readonly rootDirectory: string,
  ) {}
  create(name: string, mode: 'isolated' | 'persistent' = 'isolated', proxyId?: string) {
    return this.repository.create(name, mode, proxyId);
  }
  list() {
    return this.repository.list();
  }
  delete(id: string) {
    return this.repository.delete(id);
  }
  assignProxy(id: string, proxyId: string | null) {
    return this.repository.assignProxy(id, proxyId);
  }
  acquire(
    owner: LeaseOwner,
    id: string | undefined,
    taskId: string,
    mode: 'isolated' | 'persistent' = 'isolated',
  ) {
    return this.repository.acquire(owner, id, taskId, mode);
  }
  renew(lease: ProfileLease) {
    return this.repository.renew(lease);
  }
  release(lease: ProfileLease, quarantine = false) {
    return this.repository.release(lease, quarantine);
  }
  async directory(lease: ProfileLease) {
    await this.repository.owned(lease);
    idSchema.parse(lease.id);
    const root = resolve(this.rootDirectory);
    await mkdir(root, { recursive: true, mode: 0o700 });
    const rootReal = await realpath(root);
    const directory = join(rootReal, lease.id);
    if (!directory.startsWith(rootReal + sep))
      throw new AppError(
        'INVALID_PROFILE_PATH',
        'Profile directory is outside the approved root.',
        500,
      );
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const stat = await lstat(directory);
    if (stat.isSymbolicLink() || (await realpath(directory)) !== directory)
      throw new AppError('INVALID_PROFILE_PATH', 'Profile directory must not be a symlink.', 409);
    return directory;
  }
}
