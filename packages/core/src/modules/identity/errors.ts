import { AppError } from '@payflow/shared';

export const emailTaken = () =>
  new AppError({
    code: 'email_taken',
    status: 409,
    title: 'Email already registered',
    detail: 'An account with this email already exists',
  });

export const invalidCredentials = () =>
  new AppError({ code: 'invalid_credentials', status: 401, title: 'Invalid email or password' });

export const unauthenticated = () =>
  new AppError({ code: 'unauthenticated', status: 401, title: 'Authentication required' });

export const tokenExpired = () =>
  new AppError({
    code: 'token_expired',
    status: 401,
    title: 'Access token expired',
    detail: 'Refresh the session and retry',
  });

// The reason is logged by the route, never returned.
export const invalidRefresh = () =>
  new AppError({ code: 'invalid_refresh', status: 401, title: 'Invalid refresh token' });
