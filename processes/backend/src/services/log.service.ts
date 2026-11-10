import type { LogRepository } from '../repositories/log.repository.js';
export class LogManager {
  constructor(private readonly repo: LogRepository) {}
  list(input: Parameters<LogRepository['list']>[0]) {
    return this.repo.list(input);
  }
}
