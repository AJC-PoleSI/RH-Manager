-- AlterTable
ALTER TABLE "Availability" ADD COLUMN "date" DATETIME;

-- AlterTable
ALTER TABLE "Candidate" ADD COLUMN "comments" TEXT;

-- AlterTable
ALTER TABLE "Deliberation" ADD COLUMN "cons_comment" TEXT;
ALTER TABLE "Deliberation" ADD COLUMN "pros_comment" TEXT;

-- CreateTable
CREATE TABLE "SystemSetting" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "value" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "CandidateWish" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "candidate_id" TEXT NOT NULL,
    "pole" TEXT NOT NULL,
    "rank" INTEGER NOT NULL,
    CONSTRAINT "CandidateWish_candidate_id_fkey" FOREIGN KEY ("candidate_id") REFERENCES "Candidate" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "EvaluationSlot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "epreuve_id" TEXT,
    "date" DATETIME NOT NULL,
    "start_time" TEXT NOT NULL,
    "end_time" TEXT NOT NULL,
    "duration_minutes" INTEGER NOT NULL DEFAULT 60,
    "room" TEXT,
    "label" TEXT,
    "max_candidates" INTEGER NOT NULL DEFAULT 1,
    "min_members" INTEGER NOT NULL DEFAULT 1,
    "simultaneous_slots" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'open',
    "tour" INTEGER NOT NULL DEFAULT 1,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EvaluationSlot_epreuve_id_fkey" FOREIGN KEY ("epreuve_id") REFERENCES "Epreuve" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SlotAvailabilityRequest" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "slot_id" TEXT NOT NULL,
    "member_id" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SlotAvailabilityRequest_slot_id_fkey" FOREIGN KEY ("slot_id") REFERENCES "EvaluationSlot" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SlotAvailabilityRequest_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "Member" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SlotMemberAssignment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "slot_id" TEXT NOT NULL,
    "member_id" TEXT NOT NULL,
    CONSTRAINT "SlotMemberAssignment_slot_id_fkey" FOREIGN KEY ("slot_id") REFERENCES "EvaluationSlot" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SlotMemberAssignment_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "Member" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SlotEnrollment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "slot_id" TEXT NOT NULL,
    "candidate_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'enrolled',
    "enrolled_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SlotEnrollment_slot_id_fkey" FOREIGN KEY ("slot_id") REFERENCES "EvaluationSlot" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SlotEnrollment_candidate_id_fkey" FOREIGN KEY ("candidate_id") REFERENCES "Candidate" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_CalendarEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "day" DATETIME NOT NULL,
    "day_end" DATETIME,
    "start_time" TEXT NOT NULL,
    "end_time" TEXT NOT NULL,
    "is_global" BOOLEAN NOT NULL DEFAULT false,
    "visible_to_candidates" BOOLEAN NOT NULL DEFAULT true,
    "color" TEXT DEFAULT '#3B82F6',
    "related_epreuve_id" TEXT,
    "related_member_id" TEXT,
    "related_candidate_id" TEXT,
    "max_candidates" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT "CalendarEvent_related_epreuve_id_fkey" FOREIGN KEY ("related_epreuve_id") REFERENCES "Epreuve" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CalendarEvent_related_member_id_fkey" FOREIGN KEY ("related_member_id") REFERENCES "Member" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "CalendarEvent_related_candidate_id_fkey" FOREIGN KEY ("related_candidate_id") REFERENCES "Candidate" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_CalendarEvent" ("day", "description", "end_time", "id", "related_candidate_id", "related_epreuve_id", "related_member_id", "start_time", "title") SELECT "day", "description", "end_time", "id", "related_candidate_id", "related_epreuve_id", "related_member_id", "start_time", "title" FROM "CalendarEvent";
DROP TABLE "CalendarEvent";
ALTER TABLE "new_CalendarEvent" RENAME TO "CalendarEvent";
CREATE INDEX "CalendarEvent_related_epreuve_id_idx" ON "CalendarEvent"("related_epreuve_id");
CREATE INDEX "CalendarEvent_related_member_id_idx" ON "CalendarEvent"("related_member_id");
CREATE INDEX "CalendarEvent_related_candidate_id_idx" ON "CalendarEvent"("related_candidate_id");
CREATE INDEX "CalendarEvent_day_idx" ON "CalendarEvent"("day");
CREATE TABLE "new_CandidateEvaluation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "candidate_id" TEXT NOT NULL,
    "epreuve_id" TEXT NOT NULL,
    "member_id" TEXT NOT NULL,
    "scores" TEXT NOT NULL,
    "comment" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CandidateEvaluation_candidate_id_fkey" FOREIGN KEY ("candidate_id") REFERENCES "Candidate" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "CandidateEvaluation_epreuve_id_fkey" FOREIGN KEY ("epreuve_id") REFERENCES "Epreuve" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CandidateEvaluation_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "Member" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_CandidateEvaluation" ("candidate_id", "comment", "created_at", "epreuve_id", "id", "member_id", "scores") SELECT "candidate_id", "comment", "created_at", "epreuve_id", "id", "member_id", "scores" FROM "CandidateEvaluation";
DROP TABLE "CandidateEvaluation";
ALTER TABLE "new_CandidateEvaluation" RENAME TO "CandidateEvaluation";
CREATE INDEX "CandidateEvaluation_candidate_id_idx" ON "CandidateEvaluation"("candidate_id");
CREATE INDEX "CandidateEvaluation_epreuve_id_idx" ON "CandidateEvaluation"("epreuve_id");
CREATE INDEX "CandidateEvaluation_member_id_idx" ON "CandidateEvaluation"("member_id");
CREATE TABLE "new_Epreuve" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "tour" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "duration_minutes" INTEGER NOT NULL,
    "roulement_minutes" INTEGER NOT NULL DEFAULT 10,
    "nb_salles" INTEGER NOT NULL DEFAULT 1,
    "min_evaluators_per_salle" INTEGER NOT NULL DEFAULT 2,
    "date_debut" DATETIME,
    "date_fin" DATETIME,
    "evaluation_questions" TEXT NOT NULL,
    "is_pole_test" BOOLEAN NOT NULL DEFAULT false,
    "pole" TEXT,
    "is_group_epreuve" BOOLEAN NOT NULL DEFAULT false,
    "group_size" INTEGER NOT NULL DEFAULT 1,
    "is_visible" BOOLEAN NOT NULL DEFAULT true,
    "description" TEXT,
    "color" TEXT DEFAULT '#3B82F6'
);
INSERT INTO "new_Epreuve" ("duration_minutes", "evaluation_questions", "id", "is_pole_test", "name", "pole", "tour", "type") SELECT "duration_minutes", "evaluation_questions", "id", "is_pole_test", "name", "pole", "tour", "type" FROM "Epreuve";
DROP TABLE "Epreuve";
ALTER TABLE "new_Epreuve" RENAME TO "Epreuve";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "CandidateWish_candidate_id_idx" ON "CandidateWish"("candidate_id");

-- CreateIndex
CREATE UNIQUE INDEX "CandidateWish_candidate_id_pole_key" ON "CandidateWish"("candidate_id", "pole");

-- CreateIndex
CREATE UNIQUE INDEX "CandidateWish_candidate_id_rank_key" ON "CandidateWish"("candidate_id", "rank");

-- CreateIndex
CREATE INDEX "EvaluationSlot_epreuve_id_idx" ON "EvaluationSlot"("epreuve_id");

-- CreateIndex
CREATE INDEX "EvaluationSlot_date_idx" ON "EvaluationSlot"("date");

-- CreateIndex
CREATE INDEX "EvaluationSlot_status_idx" ON "EvaluationSlot"("status");

-- CreateIndex
CREATE INDEX "SlotAvailabilityRequest_member_id_idx" ON "SlotAvailabilityRequest"("member_id");

-- CreateIndex
CREATE UNIQUE INDEX "SlotAvailabilityRequest_slot_id_member_id_key" ON "SlotAvailabilityRequest"("slot_id", "member_id");

-- CreateIndex
CREATE INDEX "SlotMemberAssignment_member_id_idx" ON "SlotMemberAssignment"("member_id");

-- CreateIndex
CREATE UNIQUE INDEX "SlotMemberAssignment_slot_id_member_id_key" ON "SlotMemberAssignment"("slot_id", "member_id");

-- CreateIndex
CREATE INDEX "SlotEnrollment_candidate_id_idx" ON "SlotEnrollment"("candidate_id");

-- CreateIndex
CREATE INDEX "SlotEnrollment_slot_id_idx" ON "SlotEnrollment"("slot_id");

-- CreateIndex
CREATE UNIQUE INDEX "SlotEnrollment_slot_id_candidate_id_key" ON "SlotEnrollment"("slot_id", "candidate_id");

-- CreateIndex
CREATE INDEX "Availability_member_id_idx" ON "Availability"("member_id");

-- CreateIndex
CREATE INDEX "Candidate_email_idx" ON "Candidate"("email");

-- CreateIndex
CREATE INDEX "Candidate_last_name_first_name_idx" ON "Candidate"("last_name", "first_name");

-- CreateIndex
CREATE INDEX "Deliberation_candidate_id_idx" ON "Deliberation"("candidate_id");

-- CreateIndex
CREATE INDEX "EvaluatorTracking_member_id_idx" ON "EvaluatorTracking"("member_id");

-- CreateIndex
CREATE INDEX "EvaluatorTracking_candidate_id_idx" ON "EvaluatorTracking"("candidate_id");

-- CreateIndex
CREATE INDEX "Member_email_idx" ON "Member"("email");
