/*
  Warnings:

  - You are about to drop the column `description` on the `Course` table. All the data in the column will be lost.
  - You are about to drop the column `title` on the `Course` table. All the data in the column will be lost.
  - You are about to drop the column `location` on the `Meeting` table. All the data in the column will be lost.
  - You are about to drop the column `sectionId` on the `Meeting` table. All the data in the column will be lost.
  - You are about to drop the column `type` on the `Meeting` table. All the data in the column will be lost.
  - You are about to drop the column `section` on the `Section` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[code]` on the table `Course` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `credits` to the `Course` table without a default value. This is not possible if the table is not empty.
  - Added the required column `faculty` to the `Course` table without a default value. This is not possible if the table is not empty.
  - Added the required column `name` to the `Course` table without a default value. This is not possible if the table is not empty.
  - Added the required column `number` to the `Course` table without a default value. This is not possible if the table is not empty.
  - Added the required column `subject` to the `Course` table without a default value. This is not possible if the table is not empty.
  - Added the required column `offeringId` to the `Meeting` table without a default value. This is not possible if the table is not empty.
  - Added the required column `letter` to the `Section` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "public"."Meeting" DROP CONSTRAINT "Meeting_sectionId_fkey";

-- AlterTable
ALTER TABLE "public"."Course" DROP COLUMN "description",
DROP COLUMN "title",
ADD COLUMN     "credits" TEXT NOT NULL,
ADD COLUMN     "faculty" TEXT NOT NULL,
ADD COLUMN     "name" TEXT NOT NULL,
ADD COLUMN     "number" TEXT NOT NULL,
ADD COLUMN     "subject" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "public"."Meeting" DROP COLUMN "location",
DROP COLUMN "sectionId",
DROP COLUMN "type",
ADD COLUMN     "campus" TEXT,
ADD COLUMN     "offeringId" TEXT NOT NULL,
ADD COLUMN     "room" TEXT;

-- AlterTable
ALTER TABLE "public"."Section" DROP COLUMN "section",
ADD COLUMN     "letter" TEXT NOT NULL;

-- CreateTable
CREATE TABLE "public"."Offering" (
    "id" TEXT NOT NULL,
    "sectionId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "number" TEXT,
    "notes" TEXT,

    CONSTRAINT "Offering_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Course_code_key" ON "public"."Course"("code");

-- AddForeignKey
ALTER TABLE "public"."Offering" ADD CONSTRAINT "Offering_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "public"."Section"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Meeting" ADD CONSTRAINT "Meeting_offeringId_fkey" FOREIGN KEY ("offeringId") REFERENCES "public"."Offering"("id") ON DELETE CASCADE ON UPDATE CASCADE;
