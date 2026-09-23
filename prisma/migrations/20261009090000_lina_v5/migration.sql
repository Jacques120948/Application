-- Lina V5 : consentement SMS (jamais le numéro).
ALTER TABLE "LinaClient" ADD COLUMN IF NOT EXISTS "consentementSms" TEXT NOT NULL DEFAULT 'inconnu';
ALTER TABLE "LinaSynchro" ADD COLUMN IF NOT EXISTS "consentementSms" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "LinaSynchro" ADD COLUMN IF NOT EXISTS "smsRefuseAt" TIMESTAMP(3);
