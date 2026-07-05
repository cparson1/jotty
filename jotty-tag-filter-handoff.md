# Jotty: Per-Item Tag Filtering — Status

## Status: Shipped for personal use (simple checklists only)

This feature lets you filter items *within* a single simple checklist by
`#hashtags` found in item text. It reuses the existing hashtag-parsing that
Jotty already does at the checklist level (`extractHashtagsFromContent` in
`app/_utils/tag-utils.ts`), just applied per-item instead. No changes to the
markdown storage format — tags are still derived from item text at render
time, not stored as a separate field.

## What shipped

### 1. `app/_hooks/useChecklist.tsx`
- New state: `selectedItemTags: string[]`.
- Helpers: `getItemOwnTags`, `collectItemTagsDeep` (recursive, includes
  child/sub-item tags), `availableItemTags` (memoized sorted/deduped list of
  every tag in the current list), `itemMatchesTagFilter`,
  `toggleItemTagFilter`, `clearItemTagFilters`.
- `incompleteItems` / `completedItems` are filtered through
  `itemMatchesTagFilter` in addition to the existing completed/incomplete
  split.
- Hook return object exposes: `availableItemTags`, `selectedItemTags`,
  `toggleItemTagFilter`, `clearItemTagFilters`. `ChecklistView` already spreads
  hook props through to `ChecklistBody`, so no other call sites needed changes.

### 2. `ChecklistBody.tsx` (Simple checklist body)
- Tag "pill" bar rendered between `ChecklistProgress` and the item list — one
  pill per available tag, highlighted when selected (OR-filter across
  selected tags), plus a "Clear" button when any are selected.
- "No items match the selected tags" empty state, shown separately from the
  existing "no items yet" (zero-items) state.

### 3. i18n
- `checklists.clearTagFilters` and `checklists.noItemsMatchTags` added to
  **all 14** locale files (`en`, `de`, `es`, `fr`, `it`, `klingon`, `ko`,
  `nl`, `pirate`, `pl`, `pt`, `ru`, `tr`, `zh`) — verified with
  `node scripts/translations/compare-translations.js` (exits clean).

## Verified working (manual browser test, 2026-07-04)
- Ran `yarn install` + `yarn dev`, created a simple checklist, added items
  `Milk #dairy`, `Cheese #dairy`, `Bread #bakery`.
- Confirmed: pill bar shows `#bakery`/`#dairy`; clicking one filters to
  matching items; clicking both is OR (all 3 items show); "Clear" resets.
- `npx tsc --noEmit` and `yarn lint` both pass clean.
- Did **not** write an automated test suite — this is a personal fork, not a
  contribution upstream, so it wasn't worth the investment. If that changes,
  the natural place for unit tests is `tests/utils` (see
  `tests/utils/tag-utils.test.ts` for the existing pattern) — but the tag
  logic currently lives as closures inside `useChecklist.tsx`, not in a utils
  file, so it isn't unit-testable without first extracting
  `getItemOwnTags`/`collectItemTagsDeep`/`itemMatchesTagFilter` out to
  `app/_utils/checklist-utils.ts`. That extraction was started and reverted
  in this session — not done.

## Deliberately out of scope (decisions made, not oversights)
1. **Kanban boards** — only "Simple" checklists got the filter bar. Kanban
   renders through `app/_components/FeatureComponents/Kanban/Kanban.tsx`,
   which has its own item-rendering path separate from `useChecklist`'s
   incompleteItems/completedItems split. Explicitly decided not to extend
   this pass to Kanban.
2. **Nested/child item matching UX** — if a selected tag only matches a
   *child* item, the whole parent (with all children) shows, not just the
   matching child. Explicitly kept as-is (matches how search-like features
   behave elsewhere in the app) rather than pruning to matching children only.
3. **No discoverability hint** — no placeholder/hint text was added near the
   "add item" input to tell users `#tag` syntax tags an item. Not done.
4. **`VirtualizedChecklistItems.tsx`** (used when a bucket has ≥50 items)
   receives the already-filtered `items` array as a prop, so it should just
   work, but wasn't specifically exercised in manual testing (test checklist
   only had 3 items).

## Environment notes (for resuming on this machine)
- Repo lives at `C:\dev\jotty`, cloned from `https://github.com/cparson1/jotty`.
- Node.js is at `C:\dev\node` (not on system PATH — prepend it:
  `export PATH="/c/dev/node:$PATH"` in bash, or call `C:\dev\node\node.exe`
  directly on Windows).
- Yarn was installed via `npm install -g yarn` (global install lives
  alongside Node). Project uses Yarn (`yarn.lock`, no `package-lock.json`).
- To run: `yarn install` (already done once, `node_modules` should still be
  present) then `yarn dev` — Next.js/Turbopack serves on `localhost:3000`.
- First run prompts you to create an admin account (no seed users).
