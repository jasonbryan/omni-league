import { seedCallRanges } from '../../convex/lib/seedCallLimits';
import { convexRun } from './convex';

/**
 * Seeds `total` numbered accounts through `name` in sequential calls: each call is its own backend
 * transaction, and the rows list in the order the calls ran, so the calls never overlap.
 */
export async function seedAccountsInCalls(
  name: 'testing:seedWaitingFreeAgents' | 'testing:seedStaff',
  total: number,
  args: Record<string, unknown>,
): Promise<void> {
  for (const range of seedCallRanges(total)) {
    await convexRun(name, { ...args, ...range });
  }
}
