-- Photo attachments on turns (base64 + mime), for camera/document import.
ALTER TABLE "Turn" ADD COLUMN "imageData" TEXT;
ALTER TABLE "Turn" ADD COLUMN "imageMime" TEXT;
