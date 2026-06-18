import { db, pool, usersTable } from "@workspace/db";
import bcrypt from "bcryptjs";

const defaultUsers = [
  {
    name: "Admin",
    username: "admin",
    password: "admin123",
    role: "admin" as const,
    colorCode: "#000000",
    unit: "All" as const,
  },
  {
    name: "Ravi Patel",
    username: "ravi",
    password: "elham2024",
    role: "sales" as const,
    colorCode: "#ef4444",
    unit: "Himatnagar" as const,
  },
  {
    name: "Sneha Sharma",
    username: "sneha",
    password: "elham2024",
    role: "sales" as const,
    colorCode: "#f97316",
    unit: "Surat" as const,
  },
  {
    name: "Mohit Desai",
    username: "mohit",
    password: "elham2024",
    role: "sales" as const,
    colorCode: "#eab308",
    unit: "Rajkot" as const,
  },
  {
    name: "Priya Mehta",
    username: "priya",
    password: "elham2024",
    role: "sales" as const,
    colorCode: "#22c55e",
    unit: "Himatnagar" as const,
  },
  {
    name: "Deepak Kumar",
    username: "deepak",
    password: "elham2024",
    role: "sales" as const,
    colorCode: "#3b82f6",
    unit: "Surat" as const,
  },
  {
    name: "Kavita Joshi",
    username: "kavita",
    password: "elham2024",
    role: "sales" as const,
    colorCode: "#a855f7",
    unit: "Rajkot" as const,
  },
];

async function seed() {
  console.log("Seeding users...");

  for (const u of defaultUsers) {
    const passwordHash = await bcrypt.hash(u.password, 10);
    await db.insert(usersTable).values({
      name: u.name,
      username: u.username,
      passwordHash,
      role: u.role,
      colorCode: u.colorCode,
      unit: u.unit,
    }).onConflictDoNothing({ target: usersTable.username });
    console.log(`  ✓ ${u.username} (${u.role})`);
  }

  console.log("Done!");
  await pool.end();
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
