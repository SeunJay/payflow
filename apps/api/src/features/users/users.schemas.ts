// Response bodies, built field by field so every Date leaves as ISO 8601.
import type { User } from '@payflow/core';

export const userBody = (user: User) => ({ id: user.id, email: user.email, createdAt: user.createdAt.toISOString() });
