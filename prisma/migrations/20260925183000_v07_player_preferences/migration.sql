ALTER TABLE "User" ADD COLUMN "preferredAudioCodes" TEXT NOT NULL DEFAULT 'th,en,zh';
ALTER TABLE "User" ADD COLUMN "preferredSubtitleCodes" TEXT NOT NULL DEFAULT 'th,en,zh';
ALTER TABLE "User" ADD COLUMN "playbackSpeed" REAL NOT NULL DEFAULT 1;
ALTER TABLE "WatchHistory" ADD COLUMN "sourceId" TEXT;
CREATE INDEX "WatchHistory_sourceId_idx" ON "WatchHistory"("sourceId");
