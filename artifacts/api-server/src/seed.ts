import bcrypt from "bcryptjs";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const users = [
  { name: "Admin", username: "admin", password: "admin123", role: "admin", colorCode: "#6366f1", unit: "All", canViewAllReports: true, canAssignLeads: true },
  { name: "Ravi", username: "ravi", password: "elham2024", role: "sales", colorCode: "#ef4444", unit: "Himatnagar", canViewAllReports: false, canAssignLeads: false },
  { name: "Sneha", username: "sneha", password: "elham2024", role: "sales", colorCode: "#f59e0b", unit: "Surat", canViewAllReports: false, canAssignLeads: false },
  { name: "Mohit", username: "mohit", password: "elham2024", role: "sales", colorCode: "#10b981", unit: "Rajkot", canViewAllReports: false, canAssignLeads: false },
  { name: "Priya", username: "priya", password: "elham2024", role: "sales", colorCode: "#3b82f6", unit: "Himatnagar", canViewAllReports: false, canAssignLeads: false },
  { name: "Deepak", username: "deepak", password: "elham2024", role: "sales", colorCode: "#8b5cf6", unit: "Surat", canViewAllReports: false, canAssignLeads: false },
  { name: "Kavita", username: "kavita", password: "elham2024", role: "sales", colorCode: "#ec4899", unit: "Rajkot", canViewAllReports: false, canAssignLeads: false },
  { name: "Production Manager", username: "production", password: "elham2024", role: "production_manager", colorCode: "#7c3aed", unit: "All", canViewAllReports: false, canAssignLeads: false },
];

for (const u of users) {
  const passwordHash = await bcrypt.hash(u.password, 10);
  await db.insert(usersTable).values({ name: u.name, username: u.username, passwordHash, role: u.role, colorCode: u.colorCode, unit: u.unit, canViewAllReports: u.canViewAllReports, canAssignLeads: u.canAssignLeads }).onConflictDoNothing({ target: usersTable.username });
  console.log(`Seeded user: ${u.username}`);
}
console.log("Seed complete!");
