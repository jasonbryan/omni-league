import { cronJobs } from 'convex/server';
import { internal } from './_generated/api';

const crons = cronJobs();

crons.hourly('prune expired per-IP limit rows', {}, internal.ipRateLimits.prune, {});

export default crons;
