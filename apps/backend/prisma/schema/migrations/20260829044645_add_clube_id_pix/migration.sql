/*
  Warnings:

  - Added the required column `clube_id` to the `pix_charges` table without a default value. This is not possible if the table is not empty.
  - Added the required column `clube_id` to the `pix_withdrawals` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "pix_charges" ADD COLUMN     "clube_id" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "pix_withdrawals" ADD COLUMN     "clube_id" TEXT NOT NULL;

-- CreateIndex
CREATE INDEX "pix_charges_clube_id_idx" ON "pix_charges"("clube_id");

-- CreateIndex
CREATE INDEX "pix_withdrawals_clube_id_idx" ON "pix_withdrawals"("clube_id");

-- AddForeignKey
ALTER TABLE "pix_charges" ADD CONSTRAINT "pix_charges_clube_id_fkey" FOREIGN KEY ("clube_id") REFERENCES "clubes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pix_withdrawals" ADD CONSTRAINT "pix_withdrawals_clube_id_fkey" FOREIGN KEY ("clube_id") REFERENCES "clubes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
