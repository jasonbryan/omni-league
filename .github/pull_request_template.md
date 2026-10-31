Closes #

## Summary

What changed and why, in one to three sentences.

## Criteria → tests

- Criterion: `path/to/test.spec.ts`

## Migration

`none` if `convex/schema.ts` and existing data are unchanged. Otherwise short bullets:

- Data change:
- Backfill or transform steps:
- Deploy order (schema vs code):
- Rollback:
- Risk to existing records:

## Demo data

What `seed:demo` now adds or changes, or `none` with the reason.

## Gates

- [ ] Every gate on the linked issue is approved, or none applies
- [ ] Uses only technology in Accepted ADRs
- [ ] UI uses only design tokens and existing patterns, and `src/app/ui` spartan components, or a listed exception, and matches an approved mockup where one covers it, or no UI changed

## UX checklist

For UI changes, copy the list under "UX checklist" in [docs/conventions/ux.md](https://github.com/jasonbryan/omni-league/blob/main/docs/conventions/ux.md#ux-checklist) here and tick it, or write `no UI changed`.

<details><summary>Evidence</summary>

Check output, screenshots at 375px and 1280px for UI changes.

</details>
