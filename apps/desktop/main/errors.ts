export class DesktopError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
export function publicError(error: unknown) {
  return error instanceof DesktopError
    ? { code: error.code, message: error.message }
    : {
        code: "DESKTOP_OPERATION_FAILED",
        message:
          "Desktop operation failed. Check the backend connection and try again.",
      };
}
