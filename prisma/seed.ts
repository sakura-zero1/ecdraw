import { PrismaClient, UserStatus } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  const username = process.env.SEED_ADMIN_USERNAME ?? 'admin';
  const password = process.env.SEED_ADMIN_PASSWORD ?? 'Admin123456';

  const exists = await prisma.user.findUnique({
    where: { username },
  });

  if (exists) {
    console.log(`Admin user already exists: ${username}`);
    return;
  }

  const passwordHash = await bcrypt.hash(password, 10);

  const user = await prisma.user.create({
    data: {
      username,
      passwordHash,
      roles: JSON.stringify(['ADMIN']),
      status: UserStatus.ACTIVE,
    },
  });

  console.log(`Seeded admin: ${user.username} (${user.id})`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
