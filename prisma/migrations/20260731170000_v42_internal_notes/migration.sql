-- Team-only notes inside a client thread. Defaults to PUBLIC so every existing
-- message keeps its current meaning.
CREATE TYPE "MessageVisibility" AS ENUM ('PUBLIC', 'INTERNAL');
ALTER TABLE "messages" ADD COLUMN "visibility" "MessageVisibility" NOT NULL DEFAULT 'PUBLIC';
