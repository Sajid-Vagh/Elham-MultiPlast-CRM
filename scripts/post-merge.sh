#!/bin/bash
set -e

# Safe post-merge hook: only reinstall dependencies.
# Database schema changes (drizzle-kit push / migrations) are NEVER automatic.
# Apply schema changes manually and deliberately against the correct database.
# See: lib/db/migrations/ for migration SQL files.
pnpm install --frozen-lockfile
