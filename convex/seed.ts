import { v } from 'convex/values';
import { internalMutation } from './_generated/server';
import { insertTenant, type Tenant } from './lib/tenantWrites';

/**
 * The organizations of the approved mockup (design/mockups/60-organization-page.html, #73): one
 * with leagues and locations, one empty.
 */
const DEMO: Tenant[] = [
  {
    organization: { name: 'Gulf Coast Sport & Social', slug: 'gulf-coast-sport-social' },
    locations: [
      { name: 'Bayside Athletic Complex', address: '4410 Ocean Dr, Corpus Christi, TX 78412' },
      { name: 'Flour Bluff Softball Park', address: '2001 Waldron Rd, Corpus Christi, TX 78418' },
      { name: 'North Beach Sand Courts', address: '3500 Surfside Blvd, Corpus Christi, TX 78402' },
    ],
    leagues: [
      { name: 'Coed 7v7 Rec', sport: 'soccer', locations: ['Bayside Athletic Complex'] },
      { name: "Men's Over-30 11v11", sport: 'soccer', locations: ['Bayside Athletic Complex'] },
      {
        name: 'Sunday Reverse Coed 4s',
        sport: 'beachVolleyball',
        locations: ['North Beach Sand Courts'],
      },
      {
        name: 'Thursday Night Coed 2s',
        sport: 'beachVolleyball',
        locations: ['North Beach Sand Courts'],
      },
      {
        name: 'Wednesday Coed Slow-Pitch',
        sport: 'softball',
        locations: ['Flour Bluff Softball Park', 'Bayside Athletic Complex'],
      },
    ],
  },
  {
    organization: {
      name: 'Port Aransas Beach Volleyball Club',
      slug: 'port-aransas-beach-volleyball-club',
    },
    locations: [],
    leagues: [],
  },
];

/**
 * Demo data for deploy previews and staging, run by `npx convex deploy --preview-run seed:demo`
 * in netlify.toml's `deploy-preview` and `branch-deploy` contexts. Convex ignores `--preview-run`
 * on a production deploy, and the production context never passes it, so it never runs there; it
 * is deployed there only as an internal function, which no client can call.
 *
 * It writes nothing when any organization exists, so a second run, or a run on a deployment with
 * real data, changes nothing.
 */
export const demo = internalMutation({
  args: {},
  returns: v.object({ created: v.boolean(), slugs: v.array(v.string()) }),
  handler: async (ctx) => {
    if (await ctx.db.query('organizations').first()) return { created: false, slugs: [] };
    for (const tenant of DEMO) await insertTenant(ctx, tenant);
    return { created: true, slugs: DEMO.map((tenant) => tenant.organization.slug) };
  },
});
