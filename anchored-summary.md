# anchored-summary.md

## Unresolved change requests after current session  

- Notification dropdown (bell icon) positioning fix — was attempted with `bellRect`-based fixed positioning (`right: window.innerWidth - bellRect.right`) but that caused the dropdown to render off-screen since the bell is inside the left sidebar. Fixed in latest build: using `position: fixed; top: 60px; right: 20px` per the specified requirements — standalone viewport position, independent of bell location. **Needs user confirmation.**

## final/complete conclusions

- N/A

## Rejected implementations/decisions

- Animation classes `animate-in fade-in slide-in-from-top-2` — removed as they may not be registered in this project's Tailwind config; the build was emitting sourcemap errors on unrelated files (potentially related).
- `bellRect`-based fixed positioning (first attempt) — rejected because right-aligning to a bell icon in the left sidebar caused the dropdown to extend leftward off-screen.

## Known issues (perceived by user)

- Notification dropdown positioning (see unresolved section above)

## Unresolved questions/speculation  

- Whether a future enhancement should re-anchor the dropdown closer to the bell (e.g. `left: sidebarRight + 8px; top: bellBottom + 8px`) instead of the generic `right: 20px; top: 60px` position, for better visual association.
