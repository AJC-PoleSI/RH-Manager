# RH Manager (Full Stack)

This repository contains the complete source code for the RH Manager application, including the Backend (Node.js/Express) and the Frontend (Next.js/React).

## Architecture

- **Backend**: `src/` (Express API, Prisma, SQLite/Postgres) available on port `3000`.
- **Frontend**: `frontend/` (Next.js App Router, Tailwind CSS) available on port `3001`.

## Quick Start

### 1. Start Backend

```bash
# Install dependencies
npm install

# Setup Database (SQLite for dev)
npx prisma migrate dev --name init

# Start Server
npm run dev
# Running on http://localhost:3000
```

### 2. Start Frontend

```bash
cd frontend

# Install dependencies
npm install

# Start Development Server (Port 3001)
npm run dev -- -p 3001
# Open http://localhost:3001
```

## Features

- **Authentication**: Member Login (Admin/User) & Candidate Registration.
- **Dashboard**: Overview of events, calendar, and KPIs.
- **Calendar**: Interactive weekly calendar with horizontal scroll.
- **Availability**: Grid-based availability picker for members.
- **Candidates**: Management of candidate profiles.
- **Epreuves**: Configuration of exam types and evaluation grids.
- **Planning**: Automatic planning generator (Admin only).

## Verification

The system is designed to be fully functional.
1. Go to `http://localhost:3001/login`.
2. Login as Member (Admin) or Register as Candidate.
3. Explore the Dashboard and feature specific pages.

## Security scanning (Semgrep, via Docker)

Every commit is scanned locally by [Semgrep](https://semgrep.dev) running inside Docker (rulesets: `p/security-audit`, `p/secrets`, `p/owasp-top-ten`, `p/javascript`, `p/typescript`, `p/react`, `p/sql-injection`). A commit is blocked if a blocking finding is detected in the staged files.

**One-time setup after cloning:**

```bash
./scripts/setup-git-hooks.sh
```

This points git at the versioned hooks in `.githooks/` (`git config core.hooksPath .githooks`) and makes the scripts executable. Docker Desktop (or another Docker daemon) must be running.

**Manual full scan:**

```bash
./scripts/semgrep-scan.sh
```

**Emergency bypass** (use sparingly, e.g. Docker unavailable):

```bash
SKIP_SEMGREP=1 git commit -m "..."
```
