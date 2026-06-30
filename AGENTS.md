
## Goal
- Transform Lead Details page into Customer 360° Profile with all customer data available from one screen.
- Separate permanent Customer Comments from Follow-up Notes with version history, display across all CRM modules, Customer Profile view, search integration, and import support.

## Constraints & Preferences
- Do NOT redesign the UI or change existing workflow.
- Do NOT modify Follow-up, Notifications, Pipeline or Dashboard logic.
- Maintain backward compatibility with existing Leads and database.
- Customer Comments must NEVER be deleted when category, deal stage, or assignment changes.
- Every comment edit saves a history record; never overwrite previous versions.
- Return Customer Comments with existing Lead APIs wherever possible; avoid additional unnecessary API calls.
- Comments truncated to 100 chars with "View More" link; clicking shows full comments.
- Category changes tracked in `category_history` table; never lose history.

## Progress
### Done
- Phase 1: notification dedup, badge/popup behavior, lead filter counts, upcoming follow-ups (Regular Follow up + Pending), deal pipeline filter (Regular Follow up only), auto-assignment for sales, role permissions, notes history as JSON array with audit trail, query invalidation fixes across `follow-ups.tsx`, `leads.tsx`, `lead-detail.tsx`, `leads-new.tsx`, `import.tsx`, dashboard uses React Query for category counts.
- Phase 2: upcoming filter only `callStatus === "Pending"`; `notesToDisplay` returns latest-first; status dropdown (Pending/Completed/Cancelled/No Response) in edit dialog; notes history shown in edit dialog; status badges for all statuses; `pendingCount`, `todayActivities`, `followUpCount` all filter by Pending only; notification dismissal for Cancelled/No Response.
- Phase 3: Customer Comments feature — DB schema, migration, API zod schemas, TypeScript interfaces, backend contacts.ts with comment history tracking, frontend display in lead-detail.tsx, leads.tsx, follow-ups.tsx, deals.tsx. Import Excel comments mapping.
- Phase 4: Customer 360° Profile — `lead-detail.tsx` rewritten with all 10 sections:
  1. Customer Information (inline editable via dialogs)
  2. Customer Comments (existing, enhanced)
  3. Upcoming Follow-up (fetch + Complete/Call quick actions)
  4. Complete Follow-up History (chronological list, newest first)
  5. Deal Information (show/create deal inline)
  6. Activity Timeline (combined timeline from activities, category changes, comment updates, deal events)
  7. Category History (from `category_history` table, with user + timestamp)
  8. Notification History (from notifications table, related to contact)
  9. Attachments (future-ready placeholder)
  10. Quick Actions (Edit Comments, Schedule Follow-up, Move Category, Create Deal, Call, Copy Mobile, Edit Lead)
- Phase 4: Summary Card (sticky header with name, company, mobile, category, deal stage, next follow-up, customer since + Back/Move/Edit/Delete buttons)
- Phase 4: Category history tracking — automatic insert into `category_history` whenever category changes in PATCH /contacts/:id
- Phase 4: New backend endpoints:
  - `GET /contacts/:id/category-history` — returns category changes with user name
  - `GET /contacts/:id/timeline` — combined timeline of all events
  - `GET /contacts/:id/notifications` — notification history for the contact
- Phase 4: Migration `009_add_category_history.sql` (run against Supabase database)
- Phase 4: Live synchronization via React Query invalidation — after any update, all related sections automatically refresh

### In Progress
- (none)

### Blocked
- (none)

## Key Decisions
- Category history stored in `category_history` table (already existed in drizzle schema, created in DB via migration 009).
- Timeline endpoint combines 5 data sources: lead creation, activities, category history, comment history, and deal events — all sorted by date DESC.
- Inline editing uses a generic dialog (field name + value input) that calls `updateContact.mutate`.
- Follow-up completion handled via direct fetch PATCH to `/api/activities/:id` to avoid coupling with existing activity update flows.
- Summary Card uses `sticky top-0 z-10` to stay visible while scrolling.
- Pre-existing Drizzle ORM type errors in `deals.ts`, `categories.ts`, `contacts.ts` (insert overload matching) not introduced by Phase 4.

## Next Steps
- Test in dev mode with real data.
- Verify category changes appear in Category History section.
- Verify timeline shows all event types correctly.
- Test follow-up Complete button removes from Upcoming section.
- Confirm all 10 sections render correctly on mobile.

## Relevant Files
- `lib/db/src/schema/category_history.ts`: category_history table schema (pre-existing)
- `lib/db/migrations/009_add_category_history.sql`: migration to create category_history table in DB
- `artifacts/api-server/src/routes/contacts.ts`: category history tracking, GET endpoints for category-history, timeline, notifications
- `artifacts/crm/src/pages/lead-detail.tsx`: Customer 360° Profile with all 10 sections + summary card + quick actions
