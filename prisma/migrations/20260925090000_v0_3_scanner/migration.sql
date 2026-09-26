ALTER TABLE "Source" ADD COLUMN "scanIntervalHours" INTEGER NOT NULL DEFAULT 24;
ALTER TABLE "Source" ADD COLUMN "lastScanCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "VideoSource" ADD COLUMN "publishedAt" DATETIME;
ALTER TABLE "VideoSource" ADD COLUMN "fingerprint" TEXT;
CREATE INDEX "VideoSource_sourceId_idx" ON "VideoSource"("sourceId");
CREATE INDEX "VideoSource_episodeId_idx" ON "VideoSource"("episodeId");
