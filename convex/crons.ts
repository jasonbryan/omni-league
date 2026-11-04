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

export default crons;
