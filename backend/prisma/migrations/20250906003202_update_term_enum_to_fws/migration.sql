/*
  Warnings:

  - The values [Fall,Winter,Summer] on the enum `Term` will be removed. If these variants are still used in the database, this will fail.

*/
-- AlterEnum
BEGIN;
CREATE TYPE "public"."Term_new" AS ENUM ('F', 'W', 'S');
ALTER TABLE "public"."Schedule" ALTER COLUMN "term" TYPE "public"."Term_new" USING ("term"::text::"public"."Term_new");
ALTER TABLE "public"."Upload" ALTER COLUMN "term" TYPE "public"."Term_new" USING ("term"::text::"public"."Term_new");
ALTER TYPE "public"."Term" RENAME TO "Term_old";
ALTER TYPE "public"."Term_new" RENAME TO "Term";
DROP TYPE "public"."Term_old";
COMMIT;
