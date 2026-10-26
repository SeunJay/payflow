import { z } from 'zod';

/**
 * An expected, client facing failure. `code` is the stable machine readable
 * identifier clients branch on; `status` is the HTTP status it maps to.
 */
export class AppError extends Error {
  readonly code: string;
  readonly status: number;
  readonly detail: string | undefined;

  constructor(options: { code: string; status: number; title: string; detail?: string; cause?: unknown }) {
    super(options.title, { cause: options.cause });
    this.name = 'AppError';
    this.code = options.code;
    this.status = options.status;
    this.detail = options.detail;
  }
}

/**
 * 422 `validation_failed` from a Zod error. The detail lists field paths and
 * rule messages; Zod does not echo input values, so nothing secret leaks.
 */
export const validationFailed = (error: z.ZodError) =>
  new AppError({ code: 'validation_failed', status: 422, title: 'Validation failed', detail: z.prettifyError(error) });
