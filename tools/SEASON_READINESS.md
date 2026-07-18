# Season Readiness Audit

`npm run audit:season-readiness` compares the versioned compatible baseline with the current generated PoE2DB app dataset. It writes JSON and Markdown reports but never changes the baseline.

`npm run baseline:season-readiness` is the only command allowed to replace the baseline. Before writing, it executes the existing coverage, affix-group, and tier-parity validations and rejects a RED season status.

## Classification

- GREEN: additions and value changes handled by the existing data model, including bases, regular families, regular tiers, tags, stats, groups, and values in known weight arrays.
- YELLOW: new, removed, or changed crafting objects and new descriptive crafting fields. These require manual semantic review but do not automatically block a release.
- RED: new generation types, domains, flags, crafting actions, targeting rules, weighting structures, restrictions, or other behavioral rule fields.

Unknown fields are classified by their stable schema path. Fields whose path contains behavioral terms such as `action`, `target`, `rule`, `weight`, `domain`, `generation`, `restrict`, `consume`, `add`, `remove`, or `replace` are RED. Other new crafting fields are YELLOW. This deliberately prefers a false-positive review over silently accepting new engine semantics.

The audit uses technical IDs and ignores timestamps for content comparisons. Baseline replacement is never part of the import workflow.
