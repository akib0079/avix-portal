-- Leads can be campaign recipients, so they need their own opt-out flag.
ALTER TABLE "leads" ADD COLUMN "marketingOptOut" BOOLEAN NOT NULL DEFAULT false;
