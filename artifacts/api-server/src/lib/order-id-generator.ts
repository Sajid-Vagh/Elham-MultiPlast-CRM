import { db, idCountersTable } from "@workspace/db";
import { eq } from "drizzle-orm";

export function getCurrentFinancialYear(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
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

export async function generateOrderId(): Promise<string> {
  const fy = getCurrentFinancialYear();
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
