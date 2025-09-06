// scripts/wipeDummyData.js
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

// Any user whose email starts with "seed"
async function main() {
  const seedUsers = await prisma.user.findMany({
    where: { email: { startsWith: "seed" } },
    select: { id: true, email: true },
  });
  console.log(`Found ${seedUsers.length} seed users`);

  // Deleting users cascades to schedules/sessions due to your schema relations
  const ids = seedUsers.map(u => u.id);
  if (ids.length > 0) {
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
  }
  console.log("Deleted seed users and their schedules/sessions.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
