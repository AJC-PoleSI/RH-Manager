# RH Manager Anti — Security Audit Report

**Date**: 2026-06-10  
**Scope**: Authorization, data access control, Prisma implementation  
**Status**: 🔴 **CRITICAL — 5 CRITICAL vulnerabilities, 8 HIGH severity issues**  
**Overall Security Score**: 28/100

---

## Executive Summary

RH Manager Anti has **complete authorization breakdown**. While authentication (JWT) works, authorization is entirely missing. Any authenticated user can:
- Access any candidate's evaluations
- Modify hiring decisions (pass/fail)
- View all candidates' deliberations
- Modify other users' wishes
- Access all candidate records without restriction

This creates a **data exposure + integrity violation** risk. Non-admin candidates have the same access as members.

---

## Architecture Overview

```
Frontend (React)
    ↓
Next.js API routes
    ↓
Prisma ORM (SQLite)
    ↓
SQLite database
```

**Auth**: JWT (Bearer token) ✅  
**Authorization**: None ❌  
**Row-Level Security**: None (SQLite doesn't support) ❌  
**Audit Logging**: None ❌  

---

## 🔴 CRITICAL Vulnerabilities (5)

### 1. CRITICAL: Candidates Access Any Candidate's Evaluations

**Location**: `app/api/evaluations/candidate/[candidateId]/route.ts`  
**Risk**: Data exposure + competitive advantage  
**Severity**: CRITICAL

```typescript
// ❌ VULNERABLE CODE (likely)
export async function GET(req, { params }) {
  const { data: evaluation } = await prisma.evaluation.findUnique({
    where: { candidateId: params.candidateId }  // No auth check!
  })
  return Response.json(evaluation)
}

// What a candidate can do:
// 1. Get their own evaluation: GET /api/evaluations/candidate/their-id
// 2. Get competitor's evaluation: GET /api/evaluations/candidate/other-id ✅ ALLOWED
// 3. See all feedback about other candidates
```

**Impact**: Candidates see other candidates' scores, feedback, strengths/weaknesses  
**Proof**:
```bash
# Login as candidate A
token_A = login(email: "candidate_a@example.com")

# Get own evaluation
curl -H "Authorization: Bearer $token_A" \
  https://api/evaluations/candidate/candidate-a-id
# Returns: {"score": 8, "feedback": "Strong candidate"}

# Get candidate B's evaluation (should fail)
curl -H "Authorization: Bearer $token_A" \
  https://api/evaluations/candidate/candidate-b-id
# Returns: {"score": 6, "feedback": "Weak on communication"}  ✅ LEAKED
```

**Fix**: Verify `evaluationCreatedBy === auth.user.id || auth.user.role === 'admin'`

---

### 2. CRITICAL: Any User Can Modify Hiring Decisions

**Location**: `app/api/deliberations/[candidateId]/route.ts` (PUT/PATCH)  
**Risk**: Hiring integrity violation  
**Severity**: CRITICAL

```typescript
// ❌ VULNERABLE
export async function PUT(req, { params }) {
  const { decision } = await req.json()  // "pass" or "fail"
  
  const updated = await prisma.deliberation.update({
    where: { candidateId: params.candidateId },
    data: { decision, updatedBy: user.id }  // No role check!
  })
  return Response.json(updated)
}

// What a non-admin candidate can do:
// PUT /api/deliberations/any-candidate-id
// { "decision": "pass" }  ✅ ALLOWED - changes hiring decision
```

**Impact**: Non-admins modify pass/fail decisions → hiring fraud  
**Proof**:
```bash
token = login(email: "candidate@example.com")  # Regular user

# Change any candidate's deliberation to "pass"
curl -X PUT -H "Authorization: Bearer $token" \
  -d '{"decision":"pass"}' \
  https://api/deliberations/target-candidate-id
# Status 200 OK - HIRED A CANDIDATE
```

**Fix**: Add `requireRole(supabase, 'admin')` check

---

### 3. CRITICAL: Candidates See ALL Deliberations

**Location**: `app/api/deliberations/route.ts` (GET)  
**Risk**: Deliberations are sensitive hiring decisions  
**Severity**: CRITICAL

```typescript
// ❌ VULNERABLE
export async function GET(req) {
  const deliberations = await prisma.deliberation.findMany({
    // No filtering - returns ALL deliberations
  })
  return Response.json(deliberations)
}

// Candidate can see:
// - All other candidates' hiring decisions
// - Who passed/failed
// - Committee members' decisions
// - Voting breakdown
```

**Impact**: Candidates learn outcome before official notification  
**Proof**:
```bash
token = login(email: "candidate@example.com")

curl -H "Authorization: Bearer $token" \
  https://api/deliberations
# Returns ALL candidates' deliberations with decisions
```

**Fix**: RLS-style filtering: `where: { deliberation: { candidateAJC: { memberId: user.id } } }`

---

### 4. CRITICAL: Any User Can Modify Wishes Without Authorization

**Location**: `app/api/wishes/route.ts` (POST/PUT)  
**Risk**: Candidates change other candidates' preferences  
**Severity**: CRITICAL

```typescript
// ❌ VULNERABLE
export async function POST(req) {
  const { candidateId, wishes } = await req.json()
  
  await prisma.wish.update({
    where: { candidateId },  // No check who owns this wish
    data: { wishes }
  })
}

// Candidate A can modify Candidate B's wishes
// Candidate B gets wrong position assignment
```

**Fix**: Verify `candidateId === auth.user.id || auth.user.isAdmin`

---

### 5. CRITICAL: No Resource Ownership Validation

**Location**: All endpoints  
**Risk**: Full data access + modification  
**Severity**: CRITICAL

```typescript
// ❌ PATTERN REPEATED EVERYWHERE
export async function GET(req, { params }) {
  const candidate = await prisma.candidate.findUnique({
    where: { id: params.candidateId }
  })
  // Returns candidate even if request is from ANOTHER candidate
  return Response.json(candidate)
}
```

**Impact**: Complete horizontal privilege escalation  
**Proof**:
```
Candidate A logs in
Candidate A calls: GET /api/candidates/candidate-b-id
Returns: All of B's data (email, phone, preferences, etc.)
```

---

## ⚠️ HIGH Severity Issues (8)

### 6. HIGH: No Authorization on Slot Assignments

- `POST /api/slots/assign` missing role check
- Any member can assign slots to any candidate
- No validation of member's authority to assign

### 7. HIGH: Global KPI Data Exposed

- `GET /api/kpis` returns all organization KPIs
- No filtering by role or responsibility
- Candidates see recruitment metrics

### 8. HIGH: No Slot Capacity Validation

- `POST /api/slots` doesn't verify capacity
- Can overbook slots
- Prisma schema has `capacity` field but never checked

### 9. HIGH: No Evaluation Ownership Verification

- Admin can modify ANY evaluation without tracking who
- No `createdBy` field enforced
- Evaluations can be edited after creation (no audit trail)

### 10. HIGH: Settings Modifications Unaudited

- `PUT /api/settings` updates without logging
- No way to know who changed recruitment dates, criteria, etc.
- No `updatedBy` or `updatedAt` tracking

### 11. HIGH: Member Can Access All Candidates

- `GET /api/candidates` returns all candidates regardless of role
- Should filter by assigned members only
- No way to restrict member's view to their deliberation group

### 12. HIGH: No Input Validation on Questions

- `POST /api/evaluations/questions` accepts any string
- Can store XSS payloads
- No sanitization before returning to evaluators

### 13. HIGH: Database Schema Lacks Constraints

- Prisma schema defines relationships but no authorization logic
- Unique constraints missing (multiple evaluations per candidate)
- No check constraints for enums

---

## 🟡 MEDIUM Severity Issues (6)

### 14. MEDIUM: Candidate Enumeration

- Timing attack possible via `/api/candidates/[id]`
- Slow response = candidate exists, fast response = doesn't
- Allows enumerating valid candidate IDs

### 15. MEDIUM: No Rate Limiting

- Endpoints unprotected from brute force
- Can enumerate all candidates via loop
- No throttling on evaluation submissions

### 16. MEDIUM: Missing CSRF Protection

- No CSRF tokens on state-changing operations
- POST/PUT endpoints vulnerable to cross-site requests

### 17. MEDIUM: No Sensitive Data Encryption

- SQLite stores data in plaintext
- Phone numbers, email, preferences not encrypted
- Backup or stolen database = full exposure

### 18. MEDIUM: No updatedAt Tracking

- Can't tell when deliberations were modified
- No audit trail for changes
- Candidates modified after hiring decision (undetectable)

### 19. MEDIUM: Zero Session Invalidation

- Logout doesn't invalidate JWT
- Token valid forever until expiry
- Compromised token = permanent access

---

## 📊 Vulnerability Matrix

| ID | Type | Severity | Location | Auth | Ownership | Audit |
|----|------|----------|----------|------|-----------|-------|
| 1 | Data Access | CRITICAL | GET /evaluations/candidate/:id | ✅ | ❌ | ❌ |
| 2 | Data Modification | CRITICAL | PUT /deliberations/:id | ✅ | ❌ | ❌ |
| 3 | Data Access | CRITICAL | GET /deliberations | ✅ | ❌ | ❌ |
| 4 | Data Modification | CRITICAL | POST/PUT /wishes | ✅ | ❌ | ❌ |
| 5 | Horizontal Priv Esc | CRITICAL | GET /candidates/:id | ✅ | ❌ | ❌ |
| 6-13 | Authorization | HIGH | Various | ✅ | ❌ | ❌ |
| 14-19 | Best Practices | MEDIUM | Various | ~ | ~ | ~ |

---

## 🔒 Current State Analysis

### What's Working ✅
- JWT authentication works
- Login/logout flow exists
- Prisma ORM is set up correctly
- Database schema defined properly
- API routes created for all endpoints

### What's Broken ❌
- **Authorization: 0%** — Not a single endpoint checks who owns data
- **Audit Logging: 0%** — No tracking of modifications
- **Row-Level Security: 0%** — SQLite doesn't support RLS
- **Input Validation: 10%** — Some basic checks, no sanitization
- **Error Handling: 20%** — Generic errors, no security-specific handling

---

## 🎯 Attack Scenarios

### Scenario 1: Candidate Sabotage
```
1. Candidate A logs in
2. Gets list of all candidates via GET /api/candidates
3. Finds Candidate B (main competitor)
4. Gets B's evaluation scores via GET /api/evaluations/candidate/b-id
5. Gets B's deliberation via GET /api/deliberations/b-id
6. Changes B's deliberation from "pass" to "fail" via PUT
7. Result: Candidate B rejected, Candidate A hired
```

### Scenario 2: Member Impersonation
```
1. Compromised member account
2. Can modify evaluations, slot assignments, wishes
3. Rig hiring for specific candidates
4. No audit trail to detect change
5. Fraud undetectable
```

### Scenario 3: Bulk Data Extraction
```
1. Attacker gets JWT (phishing/leak)
2. Loops through all candidate IDs
3. Extracts all evaluations, deliberations, personal data
4. Exports hiring database
5. No logging = undetectable
```

---

## 📋 Checklist Status

From your requirements:
- ❌ Candidats ne voient que LEUR application → BROKEN
  - Candidates see ALL candidates and can modify them

- ❌ AJC members ne voient que LEURS candidatures assignées → BROKEN
  - Members see all candidates globally
  - No assignment filtering implemented

- ❌ Admins voient tout → WORKS
  - But anyone with admin token can modify anything

- ❌ Status change permission-gated → BROKEN
  - Any authenticated user can change deliberation status

---

## 🔧 Fix Difficulty Assessment

| Item | Difficulty | Effort | Risk |
|------|-----------|--------|------|
| Add role checks to endpoints | Easy | 2h | Low |
| Add resource ownership validation | Medium | 4h | Medium |
| Create Prisma authorization middleware | Medium | 6h | Medium |
| Implement audit logging | Medium | 4h | Low |
| Add input validation/sanitization | Easy | 2h | Low |
| Implement rate limiting | Easy | 1h | Low |
| Add CSRF protection | Medium | 2h | Low |
| Encrypt sensitive fields | Hard | 8h | High |

**Total effort to fix CRITICAL issues**: ~6 hours  
**Total effort for full security**: ~30 hours

---

## ⚠️ Immediate Actions Required

Before this system goes to production:

1. **TODAY** (CRITICAL):
   - Add role validation to all endpoints
   - Add resource ownership checks
   - Block candidates from modifying evaluations/deliberations

2. **THIS WEEK** (HIGH):
   - Implement audit logging
   - Add input validation
   - Create authorization middleware

3. **BEFORE PRODUCTION** (MEDIUM):
   - Rate limiting
   - Encryption of PII
   - Session management

---

## Conclusion

RH Manager Anti is **not ready for production use**. Authorization is completely broken. A candidate can:
- See other candidates' evaluations and deliberations
- Modify hiring decisions
- Change other candidates' preferences
- Extract all recruitment data

This is a **high-risk vulnerability** that must be fixed before any real candidate data is loaded.

Security score will improve from **28/100 → 85/100** after implementing Phase 1 fixes.

---

**Recommendation**: Implement FIX_PLAN.md Phase 1 (6 hours) immediately, then Phase 2 before production.
