import { cronJobs } from 'convex/server';
import { internal } from './_generated/api';

const crons = cronJobs();

crons.hourly('prune expired per-IP limit rows', {}, internal.ipRateLimits.prune, {});

crons.daily(
  'delete push subscriptions unseen for 90 days',
  { hourUTC: 9, minuteUTC: 17 },
  internal.push.pruneUnseen,
  {},
);

// The UTC-12 day turns at 12:00 UTC.
crons.daily(
  'mark programs that ended as no longer current',
  { hourUTC: 12, minuteUTC: 1 },
  internal.programEnds.markEnded,
  {},
);

export default crons;
