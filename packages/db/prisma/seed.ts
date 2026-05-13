// One-off seed script. Run with: npm run seed -w packages/db
// Requires DATABASE_URL and PILOT_PASSWORD env vars set.
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  const email = process.env.PILOT_EMAIL ?? 'abdulla@aptask.com';
  const password = process.env.PILOT_PASSWORD;

  if (!password) {
    console.error('Error: set PILOT_PASSWORD env var (e.g. PILOT_PASSWORD=MyP@ss npm run seed -w packages/db)');
    process.exit(1);
  }

  const passwordHash = await bcrypt.hash(password, 12);

  const user = await prisma.user.upsert({
    where: { email },
    update: { passwordHash, isAdmin: true, isActive: true },
    create: {
      email,
      passwordHash,
      firstName: 'Abdulla',
      lastName: 'Sheikh',
      isAdmin: true,
      isActive: true,
    },
  });

  console.log(`Seeded user: ${user.email} (id=${user.id}, admin=${user.isAdmin})`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
