import { db, idCountersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { ID_PREFIXES, type IdPrefix } from "@workspace/db";

export async function generateId(prefix: IdPrefix): Promise<string> {
  const [counter] = await db
    .select()
    .from(idCountersTable)
    .where(eq(idCountersTable.prefix, prefix))
    .for("update");

  if (!counter) {
    await db.insert(idCountersTable).values({ prefix, counter: 1 });
    return `${ID_PREFIXES[prefix]}-000001`;
  }

  const nextCounter = counter.counter + 1;
  await db
    .update(idCountersTable)
    .set({ counter: nextCounter, updatedAt: new Date() })
    .where(eq(idCountersTable.prefix, prefix));

  const padded = String(nextCounter).padStart(6, "0");
  return `${ID_PREFIXES[prefix]}-${padded}`;
}
