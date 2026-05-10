/**
 * Parse errors from Tauri 2 invoke() or standard Error objects into displayable messages.
 *
 * Tauri 2: when a Rust command returns Err(AppError), invoke() throws an object
 * with the serialized AppError fields { message, kind }. This function extracts
 * the human-readable message regardless of the error shape.
 */
export function parseError(error: unknown): string {
  if (error && typeof error === 'object') {
    const obj = error as Record<string, unknown>;
    if (typeof obj.message === 'string') return obj.message;
    if (obj.message) return String(obj.message);
  }
  if (typeof error === 'string') {
    try {
      const payload = JSON.parse(error) as { message?: string };
      return payload.message || error;
    } catch {
      return error;
    }
  }
  if (error instanceof Error) {
    try {
      const payload = JSON.parse(error.message) as { message?: string };
      return payload.message || error.message;
    } catch {
      return error.message;
    }
  }
  if (error) return String(error);
  return '请求失败';
}
