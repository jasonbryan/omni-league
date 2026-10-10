import { randomBytes } from 'node:crypto';
import { convexRun } from './convex';

export interface TestUser {
  name: string;
  email: string;
  /** Random per run, never stored (ADR 0005, ADR 0008 "Testing"). */
  password: string;
}

export interface Account {
  name: string;
  adultConfirmedAt: number;
  sessions: number;
}

/** A new user with a unique name and email and a random 24-character password. */
export function newUser(label = 'Player'): TestUser {
  const id = randomBytes(4).toString('hex');
  return {
    name: `E2E ${label} ${id}`,
    email: `e2e-${id}@example.test`,
    password: randomBytes(18).toString('base64url'),
  };
}

/**
 * Creates `user` through Better Auth's own sign-up (`testing:seedLeague` with `users`, ADR 0008),
 * with a throwaway organization as its tenant. Local runs only.
 */
export async function seedUser(user: TestUser = newUser()): Promise<TestUser> {
  const id = randomBytes(4).toString('hex');
  await convexRun('testing:seedLeague', {
    organization: { name: `E2E Users ${id}`, slug: `e2e-users-${id}` },
    locations: [],
    leagues: [],
    users: [user],
  });
  return user;
}

/** The account sign-up wrote for `email`, or `null` (`testing:accountByEmail`). Local runs only. */
export async function accountByEmail(email: string): Promise<Account | null> {
  return (await convexRun('testing:accountByEmail', { email })) as Account | null;
}
