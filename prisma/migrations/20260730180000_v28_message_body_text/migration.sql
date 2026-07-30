-- Denormalised plain text for previews and search. Nullable: legacy rows are
-- backfilled by scripts/backfill-message-text.ts, and readers fall back to
-- walking the JSON body when it is null.
ALTER TABLE "messages" ADD COLUMN "bodyText" TEXT;
