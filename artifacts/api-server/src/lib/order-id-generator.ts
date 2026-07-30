import { db, idCountersTable } from "@workspace/db";
import { eq } from "drizzle-orm";

export function getFinancialYear(date: Date): string {
  const year = date.getFullYear();
  const month = date.getMonth();
  // Indian FY: Apr 1 to Mar 31
  if (month >= 3) {
    const y1 = year % 100;
    const y2 = (year + 1) % 100;
    return `${String(y1).padStart(2, "0")}${String(y2).padStart(2, "0")}`;
  } else {
    const y1 = (year - 1) % 100;
    const y2 = year % 100;
    return `${String(y1).padStart(2, "0")}${String(y2).padStart(2, "0")}`;
  }
}

export async function generateOrderNumber(forDate?: Date): Promise<string> {
  const fy = getFinancialYear(forDate ?? new Date());
  const prefix = `order_${fy}`;

  const [counter] = await db
    .select()
    .from(idCountersTable)
    .where(eq(idCountersTable.prefix, prefix))
    .for("update");

  if (!counter) {
    await db.insert(idCountersTable).values({ prefix, counter: 1 });
    return `EML_${fy}_1`;
  }

  const nextCounter = counter.counter + 1;
  await db
    .update(idCountersTable)
    .set({ counter: nextCounter, updatedAt: new Date() })
    .where(eq(idCountersTable.prefix, prefix));

  return `EML_${fy}_${nextCounter}`;
}
