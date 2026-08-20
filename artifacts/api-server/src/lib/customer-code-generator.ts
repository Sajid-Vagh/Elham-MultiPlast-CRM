import { db, idCountersTable } from "@workspace/db";
import { eq } from "drizzle-orm";

export async function generateCustomerCode(): Promise<string> {
  const prefix = "customer_code";

  const [counter] = await db
    .select()
    .from(idCountersTable)
    .where(eq(idCountersTable.prefix, prefix))
    .for("update");

  if (!counter) {
    await db.insert(idCountersTable).values({ prefix, counter: 1 });
    return "EML_1";
  }

  const nextCounter = counter.counter + 1;
  await db
    .update(idCountersTable)
    .set({ counter: nextCounter, updatedAt: new Date() })
    .where(eq(idCountersTable.prefix, prefix));

  return `EML_${nextCounter}`;
}
