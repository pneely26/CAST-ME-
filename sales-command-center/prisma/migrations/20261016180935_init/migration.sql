-- CreateEnum
CREATE TYPE "Role" AS ENUM ('COORDINATOR', 'REP');

-- CreateEnum
CREATE TYPE "LeadPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "LeadStatus" AS ENUM ('NEW', 'READY_TO_CONTACT', 'CONTACT_ATTEMPTED', 'APPOINTMENT_REQUESTED', 'APPOINTMENT_SCHEDULED', 'VISITED', 'FOLLOW_UP_REQUIRED', 'INTERESTED', 'OPPORTUNITY_IN_PROGRESS', 'WON', 'LOST', 'NOT_A_FIT', 'DO_NOT_CONTACT');

-- CreateEnum
CREATE TYPE "VisitType" AS ENUM ('WALK_IN', 'SCHEDULED_APPOINTMENT', 'FOLLOW_UP', 'PHONE_CALL', 'OTHER');

-- CreateEnum
CREATE TYPE "VisitOutcome" AS ENUM ('DECISION_MAKER_UNAVAILABLE', 'LEFT_INFORMATION', 'SPOKE_WITH_DECISION_MAKER', 'INTERESTED', 'REQUESTED_CALLBACK', 'APPOINTMENT_BOOKED', 'NOT_INTERESTED', 'NO_ACCESS', 'BUSINESS_CLOSED', 'SALE_COMPLETED', 'OTHER');

-- CreateEnum
CREATE TYPE "InterestLevel" AS ENUM ('NONE', 'LOW', 'MEDIUM', 'HIGH');

-- CreateEnum
CREATE TYPE "AppointmentKind" AS ENUM ('APPOINTMENT', 'FOLLOW_UP_VISIT');

-- CreateEnum
CREATE TYPE "AppointmentStatus" AS ENUM ('SCHEDULED', 'CONFIRMED', 'COMPLETED', 'CANCELED', 'NO_SHOW');

-- CreateEnum
CREATE TYPE "AppointmentChangeAction" AS ENUM ('CREATED', 'EDITED', 'MOVED', 'CANCELED', 'COMPLETED', 'NO_SHOW', 'RESTORED');

-- CreateEnum
CREATE TYPE "RescheduleStatus" AS ENUM ('PENDING', 'APPROVED', 'DECLINED', 'CANCELED');

-- CreateEnum
CREATE TYPE "DayPlanStatus" AS ENUM ('PLANNED', 'IN_PROGRESS', 'COMPLETED', 'CHANGED');

-- CreateEnum
CREATE TYPE "StopStatus" AS ENUM ('PLANNED', 'VISITED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "FollowUpStatus" AS ENUM ('OPEN', 'DONE', 'CANCELED');

-- CreateEnum
CREATE TYPE "OpportunityStatus" AS ENUM ('PROSPECTING', 'QUALIFIED', 'PROPOSAL', 'NEGOTIATION', 'WON', 'LOST');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('NOT_APPLICABLE', 'UNPAID', 'PARTIAL', 'PAID');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('FOLLOW_UP_DUE', 'FOLLOW_UP_OVERDUE', 'APPOINTMENT_UPCOMING', 'APPOINTMENT_CANCELED', 'RESCHEDULE_REQUESTED', 'RESCHEDULE_APPROVED', 'RESCHEDULE_DECLINED', 'NEW_FEEDBACK', 'NEW_SALE', 'LEAD_NOT_VISITED', 'LEAD_ASSIGNED');

-- CreateEnum
CREATE TYPE "ImportKind" AS ENUM ('SCREENSHOT', 'CSV');

-- CreateEnum
CREATE TYPE "ImportRecordStatus" AS ENUM ('PENDING', 'IMPORTED', 'MERGED', 'SKIPPED', 'ERROR');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sessionVersion" INTEGER NOT NULL DEFAULT 1,
    "phone" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Territory" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#4f46e5',
    "notes" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Territory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Area" (
    "id" TEXT NOT NULL,
    "territoryId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "notes" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Area_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Lead" (
    "id" TEXT NOT NULL,
    "leadNumber" SERIAL NOT NULL,
    "businessName" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "contactName" TEXT,
    "jobTitle" TEXT,
    "phone" TEXT,
    "normalizedPhone" TEXT,
    "email" TEXT,
    "address" TEXT,
    "city" TEXT,
    "state" TEXT,
    "zip" TEXT,
    "normalizedAddress" TEXT,
    "territoryId" TEXT,
    "areaId" TEXT,
    "source" TEXT,
    "industry" TEXT,
    "assignedRepId" TEXT,
    "priority" "LeadPriority" NOT NULL DEFAULT 'NORMAL',
    "status" "LeadStatus" NOT NULL DEFAULT 'NEW',
    "estimatedValue" DECIMAL(12,2),
    "notes" TEXT,
    "tags" TEXT[],
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "archivedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastVisitAt" TIMESTAMP(3),
    "lastContactAt" TIMESTAMP(3),
    "lastVisitOutcome" "VisitOutcome",
    "latestFeedback" TEXT,
    "visitCount" INTEGER NOT NULL DEFAULT 0,
    "nextFollowUpAt" TIMESTAMP(3),
    "nextAppointmentAt" TIMESTAMP(3),
    "nextPlannedVisit" TIMESTAMP(3),

    CONSTRAINT "Lead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadAssignment" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "repId" TEXT NOT NULL,
    "assignedById" TEXT NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "unassignedAt" TIMESTAMP(3),

    CONSTRAINT "LeadAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Visit" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "repId" TEXT NOT NULL,
    "visitAt" TIMESTAMP(3) NOT NULL,
    "type" "VisitType" NOT NULL,
    "outcome" "VisitOutcome" NOT NULL,
    "contactEncountered" TEXT,
    "feedback" TEXT,
    "objections" TEXT,
    "interestLevel" "InterestLevel",
    "followUpAction" TEXT,
    "followUpDueAt" TIMESTAMP(3),
    "nextAppointmentId" TEXT,
    "appointmentId" TEXT,
    "notes" TEXT,
    "attachmentPath" TEXT,
    "attachmentName" TEXT,
    "attachmentMime" TEXT,
    "clientKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Visit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Appointment" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "repId" TEXT NOT NULL,
    "kind" "AppointmentKind" NOT NULL DEFAULT 'APPOINTMENT',
    "title" TEXT,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "status" "AppointmentStatus" NOT NULL DEFAULT 'SCHEDULED',
    "location" TEXT,
    "notes" TEXT,
    "cancelReason" TEXT,
    "canceledAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "clientKey" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Appointment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppointmentChange" (
    "id" TEXT NOT NULL,
    "appointmentId" TEXT NOT NULL,
    "action" "AppointmentChangeAction" NOT NULL,
    "fromStart" TIMESTAMP(3),
    "fromEnd" TIMESTAMP(3),
    "toStart" TIMESTAMP(3),
    "toEnd" TIMESTAMP(3),
    "reason" TEXT,
    "changedById" TEXT NOT NULL,
    "rescheduleRequestId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AppointmentChange_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RescheduleRequest" (
    "id" TEXT NOT NULL,
    "appointmentId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "originalStart" TIMESTAMP(3) NOT NULL,
    "originalEnd" TIMESTAMP(3) NOT NULL,
    "requestedStart" TIMESTAMP(3) NOT NULL,
    "requestedEnd" TIMESTAMP(3) NOT NULL,
    "reason" TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,
    "status" "RescheduleStatus" NOT NULL DEFAULT 'PENDING',
    "resolutionNotes" TEXT,
    "resolvedById" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "finalStart" TIMESTAMP(3),
    "finalEnd" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RescheduleRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScheduleTemplate" (
    "id" TEXT NOT NULL,
    "repId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScheduleTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScheduleTemplateDay" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "weekday" INTEGER NOT NULL,
    "label" TEXT,
    "territoryId" TEXT,
    "areaId" TEXT,
    "startTime" TEXT,
    "endTime" TEXT,
    "visitTarget" INTEGER,
    "notes" TEXT,

    CONSTRAINT "ScheduleTemplateDay_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DayPlan" (
    "id" TEXT NOT NULL,
    "repId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "label" TEXT,
    "territoryId" TEXT,
    "areaId" TEXT,
    "startTime" TEXT,
    "endTime" TEXT,
    "visitTarget" INTEGER,
    "routeNotes" TEXT,
    "status" "DayPlanStatus" NOT NULL DEFAULT 'PLANNED',
    "isOverride" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DayPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DayPlanStop" (
    "id" TEXT NOT NULL,
    "dayPlanId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "status" "StopStatus" NOT NULL DEFAULT 'PLANNED',
    "visitId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DayPlanStop_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FollowUp" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "assignedToId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "action" TEXT NOT NULL,
    "status" "FollowUpStatus" NOT NULL DEFAULT 'OPEN',
    "sourceVisitId" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FollowUp_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Opportunity" (
    "id" TEXT NOT NULL,
    "oppNumber" SERIAL NOT NULL,
    "leadId" TEXT NOT NULL,
    "repId" TEXT NOT NULL,
    "product" TEXT NOT NULL,
    "status" "OpportunityStatus" NOT NULL DEFAULT 'PROSPECTING',
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expectedCloseAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "estimatedValue" DECIMAL(12,2),
    "finalAmount" DECIMAL(12,2),
    "commissionRate" DECIMAL(6,4),
    "commissionAmount" DECIMAL(12,2),
    "paymentStatus" "PaymentStatus" NOT NULL DEFAULT 'NOT_APPLICABLE',
    "notes" TEXT,
    "sourceVisitId" TEXT,
    "lostReason" TEXT,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "archivedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Opportunity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "link" TEXT,
    "dedupeKey" TEXT NOT NULL,
    "readAt" TIMESTAMP(3),
    "channels" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportBatch" (
    "id" TEXT NOT NULL,
    "kind" "ImportKind" NOT NULL,
    "createdById" TEXT NOT NULL,
    "provider" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "ImportBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportImage" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "rawText" TEXT,
    "status" TEXT NOT NULL DEFAULT 'UPLOADED',
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImportImage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportRecord" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "imageId" TEXT,
    "rowNumber" INTEGER,
    "extracted" JSONB NOT NULL,
    "edited" JSONB,
    "confidence" JSONB,
    "sourceText" TEXT,
    "status" "ImportRecordStatus" NOT NULL DEFAULT 'PENDING',
    "leadId" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ImportRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "leadId" TEXT,
    "summary" TEXT NOT NULL,
    "data" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SavedView" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "shared" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SavedView_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppSetting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppSetting_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Territory_name_key" ON "Territory"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Area_territoryId_name_key" ON "Area"("territoryId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Lead_leadNumber_key" ON "Lead"("leadNumber");

-- CreateIndex
CREATE INDEX "Lead_normalizedName_idx" ON "Lead"("normalizedName");

-- CreateIndex
CREATE INDEX "Lead_normalizedPhone_idx" ON "Lead"("normalizedPhone");

-- CreateIndex
CREATE INDEX "Lead_normalizedAddress_idx" ON "Lead"("normalizedAddress");

-- CreateIndex
CREATE INDEX "Lead_assignedRepId_archivedAt_idx" ON "Lead"("assignedRepId", "archivedAt");

-- CreateIndex
CREATE INDEX "Lead_status_idx" ON "Lead"("status");

-- CreateIndex
CREATE INDEX "Lead_areaId_idx" ON "Lead"("areaId");

-- CreateIndex
CREATE INDEX "Lead_lastVisitAt_idx" ON "Lead"("lastVisitAt");

-- CreateIndex
CREATE INDEX "Lead_nextFollowUpAt_idx" ON "Lead"("nextFollowUpAt");

-- CreateIndex
CREATE INDEX "LeadAssignment_leadId_idx" ON "LeadAssignment"("leadId");

-- CreateIndex
CREATE INDEX "LeadAssignment_repId_idx" ON "LeadAssignment"("repId");

-- CreateIndex
CREATE UNIQUE INDEX "Visit_nextAppointmentId_key" ON "Visit"("nextAppointmentId");

-- CreateIndex
CREATE UNIQUE INDEX "Visit_clientKey_key" ON "Visit"("clientKey");

-- CreateIndex
CREATE INDEX "Visit_leadId_visitAt_idx" ON "Visit"("leadId", "visitAt");

-- CreateIndex
CREATE INDEX "Visit_repId_visitAt_idx" ON "Visit"("repId", "visitAt");

-- CreateIndex
CREATE UNIQUE INDEX "Appointment_clientKey_key" ON "Appointment"("clientKey");

-- CreateIndex
CREATE INDEX "Appointment_repId_startAt_idx" ON "Appointment"("repId", "startAt");

-- CreateIndex
CREATE INDEX "Appointment_leadId_startAt_idx" ON "Appointment"("leadId", "startAt");

-- CreateIndex
CREATE INDEX "Appointment_status_idx" ON "Appointment"("status");

-- CreateIndex
CREATE INDEX "AppointmentChange_appointmentId_createdAt_idx" ON "AppointmentChange"("appointmentId", "createdAt");

-- CreateIndex
CREATE INDEX "RescheduleRequest_status_createdAt_idx" ON "RescheduleRequest"("status", "createdAt");

-- CreateIndex
CREATE INDEX "RescheduleRequest_appointmentId_idx" ON "RescheduleRequest"("appointmentId");

-- CreateIndex
CREATE INDEX "ScheduleTemplate_repId_active_idx" ON "ScheduleTemplate"("repId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "ScheduleTemplateDay_templateId_weekday_key" ON "ScheduleTemplateDay"("templateId", "weekday");

-- CreateIndex
CREATE UNIQUE INDEX "DayPlan_repId_date_key" ON "DayPlan"("repId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "DayPlanStop_dayPlanId_leadId_key" ON "DayPlanStop"("dayPlanId", "leadId");

-- CreateIndex
CREATE INDEX "FollowUp_status_dueAt_idx" ON "FollowUp"("status", "dueAt");

-- CreateIndex
CREATE INDEX "FollowUp_leadId_idx" ON "FollowUp"("leadId");

-- CreateIndex
CREATE UNIQUE INDEX "Opportunity_oppNumber_key" ON "Opportunity"("oppNumber");

-- CreateIndex
CREATE INDEX "Opportunity_status_closedAt_idx" ON "Opportunity"("status", "closedAt");

-- CreateIndex
CREATE INDEX "Opportunity_leadId_idx" ON "Opportunity"("leadId");

-- CreateIndex
CREATE INDEX "Opportunity_repId_idx" ON "Opportunity"("repId");

-- CreateIndex
CREATE INDEX "Notification_userId_readAt_createdAt_idx" ON "Notification"("userId", "readAt", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Notification_userId_dedupeKey_key" ON "Notification"("userId", "dedupeKey");

-- CreateIndex
CREATE INDEX "ImportRecord_batchId_status_idx" ON "ImportRecord"("batchId", "status");

-- CreateIndex
CREATE INDEX "AuditLog_leadId_createdAt_idx" ON "AuditLog"("leadId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");

-- CreateIndex
CREATE UNIQUE INDEX "SavedView_userId_name_key" ON "SavedView"("userId", "name");

-- AddForeignKey
ALTER TABLE "Area" ADD CONSTRAINT "Area_territoryId_fkey" FOREIGN KEY ("territoryId") REFERENCES "Territory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_territoryId_fkey" FOREIGN KEY ("territoryId") REFERENCES "Territory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_areaId_fkey" FOREIGN KEY ("areaId") REFERENCES "Area"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_assignedRepId_fkey" FOREIGN KEY ("assignedRepId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadAssignment" ADD CONSTRAINT "LeadAssignment_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadAssignment" ADD CONSTRAINT "LeadAssignment_repId_fkey" FOREIGN KEY ("repId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadAssignment" ADD CONSTRAINT "LeadAssignment_assignedById_fkey" FOREIGN KEY ("assignedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Visit" ADD CONSTRAINT "Visit_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Visit" ADD CONSTRAINT "Visit_repId_fkey" FOREIGN KEY ("repId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Visit" ADD CONSTRAINT "Visit_nextAppointmentId_fkey" FOREIGN KEY ("nextAppointmentId") REFERENCES "Appointment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Visit" ADD CONSTRAINT "Visit_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_repId_fkey" FOREIGN KEY ("repId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppointmentChange" ADD CONSTRAINT "AppointmentChange_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppointmentChange" ADD CONSTRAINT "AppointmentChange_changedById_fkey" FOREIGN KEY ("changedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppointmentChange" ADD CONSTRAINT "AppointmentChange_rescheduleRequestId_fkey" FOREIGN KEY ("rescheduleRequestId") REFERENCES "RescheduleRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RescheduleRequest" ADD CONSTRAINT "RescheduleRequest_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RescheduleRequest" ADD CONSTRAINT "RescheduleRequest_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RescheduleRequest" ADD CONSTRAINT "RescheduleRequest_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RescheduleRequest" ADD CONSTRAINT "RescheduleRequest_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduleTemplate" ADD CONSTRAINT "ScheduleTemplate_repId_fkey" FOREIGN KEY ("repId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduleTemplateDay" ADD CONSTRAINT "ScheduleTemplateDay_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "ScheduleTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduleTemplateDay" ADD CONSTRAINT "ScheduleTemplateDay_territoryId_fkey" FOREIGN KEY ("territoryId") REFERENCES "Territory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduleTemplateDay" ADD CONSTRAINT "ScheduleTemplateDay_areaId_fkey" FOREIGN KEY ("areaId") REFERENCES "Area"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DayPlan" ADD CONSTRAINT "DayPlan_repId_fkey" FOREIGN KEY ("repId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DayPlan" ADD CONSTRAINT "DayPlan_territoryId_fkey" FOREIGN KEY ("territoryId") REFERENCES "Territory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DayPlan" ADD CONSTRAINT "DayPlan_areaId_fkey" FOREIGN KEY ("areaId") REFERENCES "Area"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DayPlanStop" ADD CONSTRAINT "DayPlanStop_dayPlanId_fkey" FOREIGN KEY ("dayPlanId") REFERENCES "DayPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DayPlanStop" ADD CONSTRAINT "DayPlanStop_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DayPlanStop" ADD CONSTRAINT "DayPlanStop_visitId_fkey" FOREIGN KEY ("visitId") REFERENCES "Visit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FollowUp" ADD CONSTRAINT "FollowUp_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FollowUp" ADD CONSTRAINT "FollowUp_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FollowUp" ADD CONSTRAINT "FollowUp_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FollowUp" ADD CONSTRAINT "FollowUp_sourceVisitId_fkey" FOREIGN KEY ("sourceVisitId") REFERENCES "Visit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Opportunity" ADD CONSTRAINT "Opportunity_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Opportunity" ADD CONSTRAINT "Opportunity_repId_fkey" FOREIGN KEY ("repId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Opportunity" ADD CONSTRAINT "Opportunity_sourceVisitId_fkey" FOREIGN KEY ("sourceVisitId") REFERENCES "Visit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportBatch" ADD CONSTRAINT "ImportBatch_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportImage" ADD CONSTRAINT "ImportImage_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "ImportBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportRecord" ADD CONSTRAINT "ImportRecord_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "ImportBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportRecord" ADD CONSTRAINT "ImportRecord_imageId_fkey" FOREIGN KEY ("imageId") REFERENCES "ImportImage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportRecord" ADD CONSTRAINT "ImportRecord_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SavedView" ADD CONSTRAINT "SavedView_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
