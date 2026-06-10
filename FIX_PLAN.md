# RH Manager Anti — Security Fix Plan

**Effort**: 20-25 hours total | **Risk**: Medium | **Timeline**: 2-3 weeks  
**Start**: Immediately (CRITICAL fixes) | **Production**: After Phase 1 + Phase 2

---

## Phase 1: CRITICAL Authorization Fixes (6 hours)

Fix horizontal privilege escalation and data exposure. Deploy this before any real data.

### 1.1 Create Authorization Middleware (1.5 hours)

**File**: `lib/auth.ts` (new)

```typescript
import { jwtVerify } from 'jose';
import { prisma } from '@/lib/prisma';

const secret = new TextEncoder().encode(process.env.JWT_SECRET!);

export interface AuthUser {
  id: string;
  email: string;
  role: 'admin' | 'member' | 'candidate';
  candidateId?: string;
}

export async function verifyAuth(token: string): Promise<AuthUser> {
  try {
    const verified = await jwtVerify(token, secret);
    return verified.payload as AuthUser;
  } catch (err) {
    throw new Error('Invalid token');
  }
}

export function getToken(req: Request): string | null {
  const auth = req.headers.get('authorization');
  if (!auth?.startsWith('Bearer ')) return null;
  return auth.slice(7);
}

// Authorization checks
export async function requireRole(user: AuthUser, roles: string[]) {
  if (!roles.includes(user.role)) {
    throw new Error(`Unauthorized: requires ${roles.join(' or ')} role`);
  }
}

export async function requireAdmin(user: AuthUser) {
  if (user.role !== 'admin') {
    throw new Error('Unauthorized: admin only');
  }
}

export async function requireOwnership(
  user: AuthUser,
  resourceOwnerId: string,
  resourceType: string
) {
  // Candidates can only access their own data
  if (user.role === 'candidate') {
    if (user.candidateId !== resourceOwnerId) {
      throw new Error(`Unauthorized: ${resourceType} belongs to another user`);
    }
  }
  // Members must be admins to access other members' data
  if (user.role === 'member' && user.id !== resourceOwnerId) {
    await requireAdmin(user);
  }
}

export async function getAuthUser(req: Request): Promise<AuthUser> {
  const token = getToken(req);
  if (!token) throw new Error('Missing authorization');
  return verifyAuth(token);
}
```

### 1.2 Create API Route Template (1 hour)

**File**: `lib/api-handler.ts` (new)

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser, AuthUser } from '@/lib/auth';

export type ApiHandler = (
  req: NextRequest,
  user: AuthUser,
  params: any
) => Promise<Response>;

export function withAuth(handler: ApiHandler) {
  return async (req: NextRequest, { params }: { params: any }) => {
    try {
      const user = await getAuthUser(req);
      return await handler(req, user, params);
    } catch (err: any) {
      console.error('Auth error:', err);
      return NextResponse.json(
        { error: err.message || 'Unauthorized' },
        { status: 401 }
      );
    }
  };
}

export function withErrorHandler(handler: ApiHandler) {
  return withAuth(async (req, user, params) => {
    try {
      return await handler(req, user, params);
    } catch (err: any) {
      console.error('Handler error:', err);
      return NextResponse.json(
        { error: err.message || 'Internal error' },
        { status: err.status || 500 }
      );
    }
  });
}
```

### 1.3 Fix Deliberations Endpoints (2 hours)

**File**: `app/api/deliberations/route.ts` (rewrite)

```typescript
import { withErrorHandler } from '@/lib/api-handler';
import { requireAdmin, AuthUser } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { NextRequest, NextResponse } from 'next/server';

// GET /api/deliberations - Only admins and assigned members see deliberations
export const GET = withErrorHandler(async (req, user, params) => {
  if (user.role === 'candidate') {
    throw new Error('Unauthorized: candidates cannot view deliberations');
  }

  let deliberations;
  
  if (user.role === 'admin') {
    // Admins see all
    deliberations = await prisma.deliberation.findMany();
  } else {
    // Members see only deliberations they're part of
    deliberations = await prisma.deliberation.findMany({
      where: {
        deliberationAJC: {
          some: {
            memberId: user.id  // Only their deliberation groups
          }
        }
      }
    });
  }

  return NextResponse.json(deliberations);
});

// PUT /api/deliberations/[candidateId] - Only admins can modify
export const PUT = withErrorHandler(async (req, user, params) => {
  await requireAdmin(user);  // ONLY ADMINS CAN CHANGE DECISIONS

  const { decision } = await req.json();
  
  if (!['pass', 'fail'].includes(decision)) {
    throw new Error('Invalid decision');
  }

  // Verify deliberation exists
  const existing = await prisma.deliberation.findUnique({
    where: { candidateId: params.candidateId }
  });

  if (!existing) {
    throw new Error('Deliberation not found');
  }

  const updated = await prisma.deliberation.update({
    where: { candidateId: params.candidateId },
    data: {
      decision,
      updatedBy: user.id,
      updatedAt: new Date()
    }
  });

  // Log change
  await prisma.auditLog.create({
    data: {
      action: 'DELIBERATION_MODIFIED',
      targetId: params.candidateId,
      userId: user.id,
      oldValue: existing.decision,
      newValue: decision
    }
  });

  return NextResponse.json(updated);
});
```

**File**: `app/api/deliberations/[candidateId]/route.ts` (rewrite)

```typescript
import { withErrorHandler } from '@/lib/api-handler';
import { requireAdmin, AuthUser, requireOwnership } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { NextResponse } from 'next/server';

// GET /api/deliberations/[candidateId] - Only admins + assigned members
export const GET = withErrorHandler(async (req, user, params) => {
  if (user.role === 'candidate') {
    throw new Error('Unauthorized');
  }

  const deliberation = await prisma.deliberation.findUnique({
    where: { candidateId: params.candidateId }
  });

  if (!deliberation) {
    throw new Error('Not found');
  }

  // Members must be assigned to this deliberation
  if (user.role === 'member') {
    const isAssigned = await prisma.deliberationAJC.findFirst({
      where: {
        deliberationId: deliberation.id,
        memberId: user.id
      }
    });
    
    if (!isAssigned) {
      throw new Error('Unauthorized: not assigned to this deliberation');
    }
  }

  return NextResponse.json(deliberation);
});
```

### 1.4 Fix Evaluations Endpoints (1.5 hours)

**File**: `app/api/evaluations/candidate/[candidateId]/route.ts` (rewrite)

```typescript
import { withErrorHandler } from '@/lib/api-handler';
import { AuthUser } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { NextResponse } from 'next/server';

// GET - Only admins, candidate's own evals, or assigned evaluators
export const GET = withErrorHandler(async (req, user, params) => {
  // Candidates can only see their own
  if (user.role === 'candidate') {
    if (user.candidateId !== params.candidateId) {
      throw new Error('Unauthorized');
    }
  }

  // Members (non-admin) must be the evaluator
  if (user.role === 'member') {
    const eval = await prisma.evaluation.findFirst({
      where: {
        candidateId: params.candidateId,
        evaluatorId: user.id  // Only if they evaluated it
      }
    });
    
    if (!eval) {
      throw new Error('Unauthorized');
    }
    
    return NextResponse.json(eval);
  }

  // Admins see all
  const evaluation = await prisma.evaluation.findUnique({
    where: { candidateId: params.candidateId }
  });

  return NextResponse.json(evaluation);
});
```

### 1.5 Fix Wishes/Preferences Endpoints (1 hour)

**File**: `app/api/wishes/route.ts` (rewrite)

```typescript
import { withErrorHandler } from '@/lib/api-handler';
import { AuthUser, requireOwnership } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { NextResponse } from 'next/server';

export const POST = withErrorHandler(async (req, user, params) => {
  const { candidateId, wishes } = await req.json();

  // Candidates can only modify their own wishes
  if (user.role === 'candidate') {
    if (user.candidateId !== candidateId) {
      throw new Error('Unauthorized: cannot modify other candidates wishes');
    }
  }

  // Members cannot modify wishes
  if (user.role === 'member') {
    throw new Error('Unauthorized: members cannot modify wishes');
  }

  const wish = await prisma.wish.update({
    where: { candidateId },
    data: { wishes, updatedAt: new Date() }
  });

  // Log change
  await prisma.auditLog.create({
    data: {
      action: 'WISH_MODIFIED',
      targetId: candidateId,
      userId: user.id,
      details: { wishes }
    }
  });

  return NextResponse.json(wish);
});
```

---

## Phase 2: Audit Logging & High-Severity Fixes (8 hours)

### 2.1 Create Audit Logging Table (1 hour)

**File**: `prisma/migrations/[timestamp]_add_audit_logs.sql`

```sql
CREATE TABLE "AuditLog" (
  "id"            TEXT PRIMARY KEY,
  "action"        TEXT NOT NULL,
  "targetId"      TEXT,
  "targetType"    TEXT,
  "userId"        TEXT NOT NULL,
  "oldValue"      TEXT,
  "newValue"      TEXT,
  "details"       TEXT,
  "ipAddress"     TEXT,
  "createdAt"     DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY ("userId") REFERENCES "User"(id)
);

CREATE INDEX "AuditLog_userId" ON "AuditLog"("userId");
CREATE INDEX "AuditLog_targetId" ON "AuditLog"("targetId");
CREATE INDEX "AuditLog_createdAt" ON "AuditLog"("createdAt");
```

**Prisma schema**:
```prisma
model AuditLog {
  id        String   @id @default(cuid())
  action    String   // DELIBERATION_MODIFIED, WISH_MODIFIED, etc.
  targetId  String   // candidate/member/slot id
  targetType String  // candidate, wish, deliberation, etc.
  user      User     @relation(fields: [userId], references: [id])
  userId    String
  oldValue  String?  // JSON
  newValue  String?  // JSON
  details   String?  // JSON
  ipAddress String?
  createdAt DateTime @default(now())
}
```

### 2.2 Add Input Validation (2 hours)

**File**: `lib/validation.ts` (new)

```typescript
import sanitizeHtml from 'sanitize-html';

export function validateEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function sanitizeString(str: string): string {
  return sanitizeHtml(str, {
    allowedTags: [],
    allowedAttributes: {}
  }).trim();
}

export function validateEvaluationScore(score: number): boolean {
  return score >= 1 && score <= 10 && Number.isInteger(score);
}

export function validateDecision(decision: string): boolean {
  return ['pass', 'fail'].includes(decision);
}

export function validateWishes(wishes: string[]): boolean {
  return (
    Array.isArray(wishes) &&
    wishes.length <= 5 &&
    wishes.every(w => typeof w === 'string' && w.length > 0)
  );
}
```

Use in endpoints:
```typescript
export const POST = withErrorHandler(async (req, user, params) => {
  const { candidateId, wishes } = await req.json();

  // Validate input
  if (!validateWishes(wishes)) {
    throw new Error('Invalid wishes format');
  }

  wishes = wishes.map(sanitizeString);  // Sanitize

  // ... rest of handler
});
```

### 2.3 Add Rate Limiting (2 hours)

**File**: `lib/rateLimit.ts` (new)

```typescript
import { LRUCache } from 'lru-cache';

interface RateLimitStore {
  [key: string]: number[];
}

const store = new Map<string, number[]>();
const WINDOW = 60 * 1000; // 1 minute
const MAX_REQUESTS = 100; // per minute

export function checkRateLimit(ipAddress: string): boolean {
  const now = Date.now();
  let requests = store.get(ipAddress) || [];

  // Remove old requests outside window
  requests = requests.filter(time => now - time < WINDOW);

  if (requests.length >= MAX_REQUESTS) {
    return false; // Rate limited
  }

  requests.push(now);
  store.set(ipAddress, requests);
  return true;
}

export function rateLimitMiddleware(req: Request) {
  const ip = req.headers.get('x-forwarded-for') || 'unknown';
  
  if (!checkRateLimit(ip)) {
    throw new Error('Rate limit exceeded');
  }
}
```

Use:
```typescript
export const GET = withErrorHandler(async (req, user, params) => {
  rateLimitMiddleware(req);  // Add this line
  // ... rest
});
```

### 2.4 Fix Slot Assignment Authorization (2 hours)

**File**: `app/api/slots/assign/route.ts` (rewrite)

```typescript
import { withErrorHandler } from '@/lib/api-handler';
import { requireAdmin, AuthUser } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { NextResponse } from 'next/server';

export const POST = withErrorHandler(async (req, user, params) => {
  // Only admins can assign slots
  if (user.role !== 'admin') {
    throw new Error('Unauthorized: only admins can assign slots');
  }

  const { slotId, candidateId } = await req.json();

  // Verify slot exists and has capacity
  const slot = await prisma.slot.findUnique({
    where: { id: slotId },
    include: { _count: { select: { assignments: true } } }
  });

  if (!slot) {
    throw new Error('Slot not found');
  }

  if (slot._count.assignments >= slot.capacity) {
    throw new Error('Slot is at capacity');
  }

  // Verify candidate exists
  const candidate = await prisma.candidate.findUnique({
    where: { id: candidateId }
  });

  if (!candidate) {
    throw new Error('Candidate not found');
  }

  const assignment = await prisma.slotAssignment.create({
    data: {
      slotId,
      candidateId
    }
  });

  // Log
  await prisma.auditLog.create({
    data: {
      action: 'SLOT_ASSIGNED',
      targetId: candidateId,
      userId: user.id,
      details: JSON.stringify({ slotId })
    }
  });

  return NextResponse.json(assignment, { status: 201 });
});
```

### 2.5 Fix KPI Visibility (1 hour)

**File**: `app/api/kpis/route.ts` (rewrite)

```typescript
import { withErrorHandler } from '@/lib/api-handler';
import { requireAdmin, AuthUser } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { NextResponse } from 'next/server';

export const GET = withErrorHandler(async (req, user, params) => {
  // Only admins can view KPIs
  if (user.role !== 'admin') {
    throw new Error('Unauthorized: KPI data is admin-only');
  }

  const kpis = await prisma.kPI.findMany();
  return NextResponse.json(kpis);
});
```

---

## Phase 3: Hardening & Encryption (10 hours)

### 3.1 Encrypt PII Fields (6 hours)

Add `pii_encrypted` field for:
- Phone numbers
- Alternative emails
- Personal notes

Use `crypto` module to encrypt/decrypt.

### 3.2 Implement Session Management (2 hours)

- Add `invalidatedAt` to JWT
- Check on every request
- Support logout

### 3.3 Add CSRF Protection (2 hours)

- Generate CSRF tokens
- Validate on state-changing endpoints

---

## 📋 Implementation Checklist

### Phase 1 (6 hours)
- [ ] Create `lib/auth.ts` with authorization functions
- [ ] Create `lib/api-handler.ts` with middleware
- [ ] Rewrite `GET /api/deliberations` - filter by role/assignment
- [ ] Rewrite `PUT /api/deliberations/[id]` - admin only
- [ ] Rewrite `GET /api/evaluations/candidate/[id]` - ownership check
- [ ] Rewrite `POST /api/wishes` - ownership check
- [ ] Test all 5 CRITICAL endpoints

### Phase 2 (8 hours)
- [ ] Create audit logging table & model
- [ ] Create `lib/validation.ts`
- [ ] Create `lib/rateLimit.ts`
- [ ] Add input validation to 5+ endpoints
- [ ] Add rate limiting to public endpoints
- [ ] Rewrite slot assignment endpoint
- [ ] Fix KPI visibility
- [ ] Test HIGH-severity fixes

### Phase 3 (10 hours)
- [ ] Add PII encryption
- [ ] Implement session invalidation
- [ ] Add CSRF tokens
- [ ] Full audit logging integration
- [ ] Security headers (Content-Security-Policy, etc.)

---

## 🧪 Testing Plan

### Phase 1 Tests
```bash
# Test 1: Candidate cannot see other evaluations
curl -H "Authorization: Bearer candidate-token" \
  /api/evaluations/candidate/other-id
# Expected: 401 Unauthorized

# Test 2: Member cannot modify deliberations
curl -X PUT -H "Authorization: Bearer member-token" \
  -d '{"decision":"pass"}' \
  /api/deliberations/some-id
# Expected: 401 Unauthorized

# Test 3: Only admin can modify deliberations
curl -X PUT -H "Authorization: Bearer admin-token" \
  -d '{"decision":"pass"}' \
  /api/deliberations/some-id
# Expected: 200 OK
```

### Phase 2 Tests
- Verify audit logs created for all modifications
- Test rate limiting (100 requests/min)
- Test input sanitization (try XSS payloads)

### Phase 3 Tests
- Verify PII encrypted in database
- Test session invalidation
- Test CSRF token validation

---

## 🚀 Deployment Timeline

**Week 1**: Phase 1 (CRITICAL)
- Implement authorization fixes
- Test thoroughly
- Deploy to staging

**Week 2**: Phase 2 (HIGH)
- Implement audit logging
- Add validation & rate limiting
- Test end-to-end
- Deploy to production

**Week 3**: Phase 3 (MEDIUM)
- Encryption
- Session management
- CSRF protection

---

## ⚠️ Rollback Plan

If Phase 1 breaks something:
```bash
# Revert to previous version
git revert <commit-hash>

# Restore old API handlers (without auth)
# Keep JWT validation but skip role/ownership checks

# Test immediately
npm run test
```

---

## 📞 Questions?

**Authorization**: See `lib/auth.ts` for all functions  
**Endpoints**: Use `withErrorHandler` wrapper + `requireRole`/`requireOwnership` checks  
**Audit**: Log to `auditLog` table every state change  
**Testing**: SQL queries provided above; test candidates, members, admins separately

---

**Status**: Ready to implement
**Priority**: CRITICAL - do not deploy without Phase 1
**Effort**: 6h (P1) + 8h (P2) + 10h (P3) = 24 hours
**Risk**: Low (authorization fixes are backwards compatible)
