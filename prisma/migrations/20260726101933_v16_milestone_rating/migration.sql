-- AlterTable
ALTER TABLE "milestones" ADD COLUMN     "clientRating" INTEGER,
ADD COLUMN     "clientRatingNote" TEXT,
ADD COLUMN     "ratedAt" TIMESTAMP(3);
