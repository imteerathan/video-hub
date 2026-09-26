CREATE TABLE "MediaTrack" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "videoSourceId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "languageCode" TEXT,
  "languageLabel" TEXT NOT NULL,
  "url" TEXT NOT NULL,
  "mimeType" TEXT,
  "format" TEXT,
  "isDefault" BOOLEAN NOT NULL DEFAULT false,
  "isForced" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MediaTrack_videoSourceId_fkey" FOREIGN KEY ("videoSourceId") REFERENCES "VideoSource" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "MediaTrack_videoSourceId_idx" ON "MediaTrack"("videoSourceId");
CREATE INDEX "MediaTrack_videoSourceId_kind_idx" ON "MediaTrack"("videoSourceId", "kind");
