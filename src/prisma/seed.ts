import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import { hashPassword } from '../auth/crypto.util.js';
import { PrismaClient, UserRole } from '../generated/prisma/client.js';

function splitFullName(fullName: string) {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: '', lastName: '' };
  if (parts.length === 1) return { firstName: parts[0], lastName: '' };
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') };
}

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL environment variable is required');
  }

  const email = (process.env.ADMIN_EMAIL ?? 'admin@slimza.com')
    .trim()
    .toLowerCase();
  const password = process.env.ADMIN_PASSWORD ?? 'Admin@12345';
  const name = (process.env.ADMIN_NAME ?? 'Slimza Admin').trim();
  const { firstName, lastName } = splitFullName(name);

  const pool = new pg.Pool({ connectionString });
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter });

  try {
    const passwordHash = await hashPassword(password);
    const now = new Date();

    const admin = await prisma.user.upsert({
      where: { email },
      update: {
        name,
        firstName,
        lastName,
        passwordHash,
        role: UserRole.ADMIN,
        isEmailVerified: true,
        emailVerifiedAt: now,
      },
      create: {
        name,
        firstName,
        lastName,
        email,
        passwordHash,
        role: UserRole.ADMIN,
        isEmailVerified: true,
        emailVerifiedAt: now,
      },
    });

    console.log(
      `Seeded admin user: id=${admin.id} email=${admin.email} role=${admin.role} verified=${admin.isEmailVerified}`,
    );

    // Seed default CMS sections
    const defaultSections: Record<string, unknown> = {
      bundle_banner: {
        imageUrl: '/banner/bundle-reward-banner.png',
        altText: 'Spend £500+ on bundles, get £5 off your order - Bundle Reward',
        href: '/bundle',
        active: true,
      },
    };

    for (const [key, data] of Object.entries(defaultSections)) {
      await prisma.cmsSection.upsert({
        where: { key },
        update: {},
        create: {
          key,
          data: data as any,
        },
      });
      console.log(`Ensured CMS section "${key}" is seeded.`);
    }
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

await main();
