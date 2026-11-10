export class AppError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 400,
    public readonly retryable = false,
  ) {
    super(message);
    this.name = 'AppError';
  }
}
export class PauseSignal extends Error {}
export const notFound = (name: string) => new AppError('NOT_FOUND', `${name} was not found.`, 404);
export const conflict = (message: string) => new AppError('STATE_CONFLICT', message, 409);
export const safeError = (error: unknown) =>
  error instanceof AppError
    ? { code: error.code, message: error.message }
    : { code: 'INTERNAL_ERROR', message: 'The operation could not be completed.' };
