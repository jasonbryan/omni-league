// Vendored from spartan helm v1.9.0 (`libs/helm/skeleton`), with the Nova style's classes
// (`libs/registry/src/styles/style-nova.css`) inlined in place of its `spartan-skeleton` name.
// Local changes, to keep when re-copying from upstream:
// - `classes()` is a static host `class`, so a chunk that uses it carries no class-merging code;
// - no `rounded-md` and no `block`: with no class merging, helm's `rounded-md` would beat the page's
//   `rounded-full` or `rounded-lg`, so each use sets its one radius class and its own display class.
export * from './hlm-skeleton';
