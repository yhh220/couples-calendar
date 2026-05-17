# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev        # start Vite dev server (HMR)
npm run build      # production build → dist/
npm run lint       # ESLint
npm run preview    # preview production build locally
```

Deploying Firestore security rules (requires `firebase login` first):
```bash
firebase deploy --only firestore:rules
```

Vercel auto-deploys on every push to `main`.

## Architecture

Everything lives in `src/App.jsx` — one large file with all components, state, and Firestore subscriptions. There are no separate route files or component directories.

### Firebase collections

| Collection | Purpose |
|---|---|
| `events/{eventId}` | User-created calendar events (personal, together, anniversary, work, etc.) |
| `school_events/{eventId}` | School timetable events (exams, breaks, results) |
| `users/{uid}` | Per-user profile data including `stickers` array (reusable sticker library) |
| `couple/{doc}` | Shared data: `couple/shared` holds app config (maintenance flag, togetherDate); `couple/diary_{date}` holds shared sticker placements for a date |
| `pencil/{uid}-{date}` | Private sticker placements per user per date |

### Sticker system

Stickers replace the old canvas drawing. Workflow:
1. User uploads images → compressed to max 200×200px WebP (quality 0.85) via canvas `toDataURL` → stored as data URLs in `users/{uid}.stickers`
2. Placed stickers for a date are stored as `[{id, imageUrl, x, y, w, opacity}]` where `x`/`y` are 0–1 fractions of the canvas size
3. Private placements → `pencil/{uid}-{date}` · Shared placements → `couple/diary_{date}`
4. Drag handled via `setPointerCapture` + pointer events

### Firestore security rule gotcha

The `pencil` collection has `(resource.data.private != true || isOwner())` — Firestore **rejects collection-group queries** when it cannot statically prove all matching docs satisfy the rule. The workaround: shared sticker data is stored in `couple/diary_{date}` (simple `isAuthorized()` rule), not in `pencil`. The private subscription adds a client-side `&& !data.shared` filter for legacy docs.

### Two-user access model

Only two emails are authorized (`HIM_EMAIL` / `HER_EMAIL`). Access is enforced both in `firestore.rules` (server) and in `ALLOWED_EMAILS` (client guard after auth). Event ownership tracks `owner: "him" | "her"` and `ownerEmail`.

### Event types and colors

`evClass()` maps an event to a CSS class name used for coloring:
- `together`, `anniversary` → shared/couple colors
- `exam`, `holiday`, `personal`, `school` → their own colors
- `him` / `her` → owner-specific colors for work/social/assign events

School events derive their type automatically from `schoolType` (`exam→exam`, `break→holiday`, `results/assign→assign`).

### Offline support

`enableIndexedDbPersistence(db)` in `src/firebase.js` enables offline reads/writes. An `OfflineBanner` component listens to `window online/offline` events and shows a banner when disconnected.

### CSS

Styles live in `src/index.css` (custom properties, no Tailwind utilities used in practice despite Tailwind being installed). Breakpoints: `≤900px` (tablet/mobile), `≤600px` (phone bottom-sheet), `≤380px` (small phone), `≥1400px` (large desktop).
