# Jotty: Per-Item Tag Filtering — Status

## Session 3 addition: Undo toast + drag-to-recategorize

### Undo toast (check/uncheck + drag reorder)
- `app/_components/GlobalComponents/Feedback/Toast.tsx`: `Toast` interface
  gained `action?: { label: string; onClick: () => void }`; renders a text
  button next to the close (×) button. This was previously unused by any
  call site in the app — first consumer.
- `app/_consts/checklists.ts`: `UNDO_TOAST_DURATION_SECONDS = 5` — a plain
  code constant, **not** wired into the profile/settings UI. Change this
  value directly if you want a different duration; deliberately skipped the
  full settings-UI route (type + zod schema + UserPreferencesTab UI + 14
  locale files) since this is a personal fork and the constant is trivial to
  edit directly.
- `app/_hooks/useChecklist.tsx`:
  - `handleToggleItem` now calls `showToast` after queuing the optimistic
    toggle, with `title` = the item's text (category-stripped via
    `stripItemCategoryFromContent`) and `action.onClick` = calling
    `handleToggleItem(itemId, !completed)` again — undo is just "redo the
    opposite toggle," which is correct regardless of the existing 500ms
    `pendingToggles` debounce/sync timing.
  - `handleDragEnd` captures an `undoTarget` (an anchor sibling — or parent,
    for the "drop into" case — to recreate the item's pre-drag position)
    **before** mutating anything, computed from `activeInfo.siblings`/`index`
    at their pre-move values. After a successful `reorderItems` persist, it
    shows an undo toast whose action constructs a synthetic `DragEndEvent`
    (`{ active: { id }, over: { id, data } }` shaped to match exactly what
    `handleDragEnd` destructures) and re-invokes `handleDragEnd` with it —
    reusing 100% of the existing, working reorder logic rather than
    duplicating it. Calling undo on a drag-undo naturally chains (undo of an
    undo works, same as the toggle case), since it's just another drag move.
  - If `activeInfo.siblings.length === 1` **and** the item had no parent
    (i.e. it was the only item in the entire root list), `undoTarget` stays
    `null` and no undo toast is shown for that drag — there's no valid
    anchor to reconstruct the position from. Edge case, not expected to come
    up often.

### Drag-to-recategorize + missing drop indicators
- Previously: `@category` grouping (see below) was purely position-blind —
  dragging an item into a different category's visual section wouldn't
  actually change its category (since category is derived from the item's
  own `@tag` text, not array position), so it would appear to "snap back" to
  its original section after the drop completed and groups recomputed.
- Fixed by making the drag itself rewrite the item's text:
  - `app/_utils/tag-utils.ts`: new `setItemCategoryInContent(content, newCategory)`
    — strips any existing `@category` then appends `@newCategory` (or just
    strips, if `newCategory` is `null`, i.e. dropping into the uncategorized
    zone).
  - `handleDragEnd` (`useChecklist.tsx`) now computes `activeCategory` /
    `overCategory` via `getItemCategory` on the dragged item and the anchor
    item at the drop location. If they differ (and it's not a "drop into"
    /nesting move — nesting is left untouched, category recategorization
    only applies to sibling-reorder drops), the dragged item's text is
    rewritten in both the optimistic local update and persisted via a
    follow-up `updateItem` call after `reorderItems` succeeds.
  - **How target category is determined**: simply `getItemCategory` of
    whatever item you drop next to/before/after (the "anchor"). Drop next to
    an `@dairy`-tagged item → you become `@dairy`. Drop next to an
    uncategorized item → your `@category` tag is stripped. No new drop-zone
    metadata was needed — the existing anchor-item-based reorder mechanics
    already tell us exactly which category's neighborhood we landed in.
  - Undo naturally reverses the recategorization too, with zero special
    casing: undo re-invokes `handleDragEnd` targeting the *original*
    neighborhood's anchor item, so the same category-mismatch check fires
    again and restores the original tag.
- `ChecklistBody.tsx`: added the missing `DropIndicator` before the first
  item and after each item *inside* every `CategorySection` (previously only
  the trailing uncategorized-items list had these). Now there's a visible
  insertion line everywhere you can actually drop, including within and at
  the boundaries of category groups.
- **Known gaps, not fixed:**
  - Dropping into a **collapsed** category section isn't possible (no items
    are rendered in the DOM while collapsed, so there's nothing to anchor a
    `DropIndicator` to) — expand it first.
  - Dropping into a category whose visible members are all hidden by the
    active `#hashtag` filter (`matchedCount === 0`, `totalCount > 0`) has no
    anchor either, same reason.
  - Recategorization only fires for top-level sibling reorders, not for
    "drop into" (nesting) moves — nesting an item under another doesn't
    change its category.
- **Not verified via automated browser drag simulation** — dnd-kit's
  keyboard sensor didn't respond to synthetic (untrusted) `KeyboardEvent`s
  dispatched via automation, and simulating a real pointer drag sequence
  wasn't attempted. The toggle-undo path *was* fully verified end-to-end in
  the browser (toast appears, Undo reverts, natural expiry leaves the change
  in place). Manually verify: (1) drag within a category, (2) drag between
  two categories (confirm the `@tag` in the item's text actually changes),
  (3) drag into the uncategorized zone (confirm `@tag` is stripped), (4) undo
  each of those.

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

### 4. Clicking an inline `#tag` on an item now filters instead of navigating
- Previously, clicking the underlined `#tag` rendered inline in an item's
  text (via `TagLinkViewComponent` in `app/_components/FeatureComponents/Tags/TagLinkComponent.tsx`)
  always navigated to the global `/?mode=tags&tag=...` view.
- `TagLinkViewComponent` now accepts an optional `onClick?: (tag: string) => void`;
  when provided it's called instead of the `router.push` navigation.
- `NestedChecklistItem.tsx` accepts a new `onTagClick?: (tag: string) => void`
  prop, threads it into `renderTextWithHashtags`'s `TagLinkViewComponent`
  calls, and passes it down through its own recursive child-item rendering.
- `VirtualizedChecklistItems.tsx` accepts and threads the same prop.
- `ChecklistBody.tsx` passes `onTagClick={toggleItemTagFilter}` at all four
  `NestedChecklistItem`/`VirtualizedChecklistItems` render sites (incomplete/
  completed × virtualized/non-virtualized).
- Net effect: clicking `#dairy` on an item toggles `dairy` into/out of the
  item-tag filter selection (same as clicking the pill), instead of leaving
  the checklist. The `TagLinkComponent` used inside the TipTap editor (notes)
  is untouched — only the checklist item view path got the new prop.

### 5. `@category` item grouping (broad category, separate from `#hashtag`)
- New tag syntax: `@word` in item text denotes a broad category (distinct
  from `#hashtag`). An item can have at most one category — the *first*
  `@word` match in its own text (not descended into children).
- `extractItemCategoryFromContent(content): string | null` added to
  `app/_utils/tag-utils.ts`, mirroring `extractHashtagsFromContent`'s
  code-block-stripping/anchoring approach but for a single `@` match, no `/`
  nesting allowed (categories are flat, unlike hashtags).
- `useChecklist.tsx`: `getItemCategory(item)` wraps the extractor;
  `groupItemsByCategory(allItems, filteredItems, getItemCategory)` computes,
  per bucket (incomplete/completed), a sorted list of
  `{ category, totalCount, matchedCount, items }` groups plus a leftover
  `uncategorizedItems` array. `totalCount` is computed from the bucket
  *before* the `#hashtag` filter is applied; `matchedCount`/`items` come from
  *after* it — this is what makes the header read e.g. `@produce (2/6)` when
  a tag filter narrows 6 category members down to 2 visible ones.
- New hook exports: `incompleteCategoryGroups`, `incompleteUncategorizedItems`,
  `completedCategoryGroups`, `completedUncategorizedItems` (type
  `ItemCategoryGroup[]`, exported from `useChecklist.tsx`).
- New component `Parts/Simple/CategorySection.tsx`: collapsible section
  (chevron icon, default expanded, local `useState` — not persisted) showing
  `@{category} ({matchedCount}/{totalCount})` as its header.
- `ChecklistBody.tsx`: in the non-virtualized render path only, renders one
  `CategorySection` per group (in sequence, alphabetical) followed by the
  plain uncategorized-items list (using the exact same `NestedChecklistItem`/
  `DropIndicator` markup as before). When no items have a category, groups is
  `[]` and `uncategorizedItems` equals the full bucket — so it degrades to
  today's exact flat rendering with zero visual change. No new i18n strings
  needed (the category label is user-authored text, not a static string).
- **No pill/filter UI for categories** — deliberate choice per this session's
  discussion. Categories are pure grouping/display; the existing `#hashtag`
  pill bar and `selectedItemTags` filter are completely unaffected and still
  the only filterable dimension. A category section's counts just reflect
  whatever the hashtag filter currently narrows down to.
- **Known rough edge, accepted for now:** drag-and-drop reordering is
  unaffected *within* a category's items or within the uncategorized list
  (same `DropIndicator`/`useDraggable` machinery as before), but there's no
  `DropIndicator` *between* category sections, so dragging an item across a
  category boundary has no precise visual drop target. Items remain
  individually draggable regardless; this just means cross-category drops are
  a bit imprecise. Not fixed — full category-aware DnD would be a much bigger
  change for a personal-use nicety.
- **Virtualized path (≥50 items in a bucket) does not group by category** —
  same scope limitation as the original tag-filter work; `VirtualizedChecklistItems`
  renders its flat list unchanged regardless of `@category` tags present.

## Verified working (manual browser test, 2026-07-04/05)
- Ran `yarn install` + `yarn dev`, created a simple checklist, added items
  `Milk #dairy`, `Cheese #dairy`, `Bread #bakery`.
- Confirmed: pill bar shows `#bakery`/`#dairy`; clicking one filters to
  matching items; clicking both is OR (all 3 items show); "Clear" resets.
- Confirmed inline `#tag` click on an item toggles the filter instead of
  navigating away, in both directions (toggle on/off), reproducibly across a
  clean dev server restart.
- Confirmed `@category` grouping: items with e.g. `@category3` grouped under
  a collapsible `@category3 (N/M)` header; collapse/expand works; header
  counts update correctly when a `#hashtag` filter narrows the visible set
  (verified `(1/2)` and `(0/1)` cases); works independently in both the "To
  Do" and "Completed" sections when an item is checked off.
- `npx tsc --noEmit` and `yarn lint` both pass clean after each round of changes.
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

## Dev-mode caching gotcha (fixed) — read this if changes stop showing up
`next.config.mjs` had a `headers()` rule applying
`Cache-Control: public, max-age=31536000, immutable` to `*.js`/`*.css`
(intended for production's content-addressed `/_next/static` assets). In
Turbopack **dev** mode, chunk URLs are stable across restarts (not
content-hashed the way prod build output is), so the browser was permanently
caching the first-ever version of each JS chunk it loaded and silently
serving that stale copy forever after — surviving full dev-server restarts
and even `.next` cache wipes, because the staleness lived in the *browser's*
HTTP cache, not the server. Symptom: edits to a component (e.g. adding a new
prop) have zero effect in the browser no matter how much you restart the
server, until eventually a mismatched-module-version runtime error appears.
Fixed by gating that `headers()` rule on `process.env.NODE_ENV === "production"`
(returns `[]` in dev). If you ever hit "changes aren't showing up" again
after this, it's almost certainly this same class of issue re-appearing
elsewhere — check for other custom cache headers before assuming Turbopack
itself is broken.

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
