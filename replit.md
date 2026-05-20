# Elham Multiplast CRM

A full-featured CRM for Elham Multiplast LLP — a plastics manufacturer with 6 sales team members across 3 units (Himatnagar, Surat, Rajkot).

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 8080, via proxy at /api)
- `pnpm --filter @workspace/crm run dev` — run the CRM frontend (via proxy at /)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string, `SESSION_SECRET`

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5 (artifacts/api-server), mounted at `/api`
- Frontend: React + Vite + Tailwind (artifacts/crm), mounted at `/`
- DB: PostgreSQL + Drizzle ORM (lib/db)
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from lib/api-spec/openapi.yaml → lib/api-client-react)
- Build: esbuild (CJS bundle for API)

## Where things live

- `lib/db/src/schema/` — DB schema (users, contacts, products, deals, deal_products, activities)
- `lib/api-spec/openapi.yaml` — OpenAPI spec (source of truth for API contract)
- `lib/api-client-react/src/generated/` — auto-generated React Query hooks
- `artifacts/api-server/src/routes/` — Express route handlers
- `artifacts/crm/src/pages/` — React pages

## Architecture decisions

- Session auth via in-memory Map (Bearer token in localStorage as `crm_token`). Sessions are lost on API server restart — acceptable for internal tool.
- Contacts = "Leads" throughout the UI. Each contact has a sales owner with a color code.
- Deals have 8 stages: New → CL Sent → Price Given → Samples Sent → Samples Received → PI Sent → Won / Lost
- Duplicate detection: contacts sharing mobile/email assigned to different sales owners
- IndiaMart import creates a contact directly; Excel import parses tab-separated or JSON data

## Product

- **Login** — username/password auth per team member
- **Leads** — full contact management with search/filter by owner/city/unit/industry
- **Lead Detail** — contact info, deals, activity log (Call/WhatsApp/Email)
- **Pipeline (Deals)** — Kanban-style board across 8 stages
- **Deal Detail** — stage management, lost reason, products, activity log
- **Products** — catalog management with bottle specs
- **Reports** — pipeline, by-owner, by-city, by-product with month/unit/owner filters
- **Import** — IndiaMart single lead + Excel/tab-separated bulk import
- **Duplicates** — cross-owner duplicate contact detection
- **Settings** — team member management (admin only) with color codes

## User preferences

- Currency: ₹ (Indian Rupees)
- 3 units: Himatnagar, Surat, Rajkot
- 6 sales team members + 1 admin (CEO)

## Default Credentials

- Admin: `admin` / `admin123`
- Sales team: `ravi`, `sneha`, `mohit`, `priya`, `deepak`, `kavita` — all password `elham2024`

## Gotchas

- API server sessions are in-memory — restart clears all active sessions
- Run `pnpm --filter @workspace/api-spec run codegen` after changing openapi.yaml
- Run `pnpm --filter @workspace/db run push` after changing schema files
- The `/contacts/duplicates` route must be defined before `/contacts/:id` in contacts.ts

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
