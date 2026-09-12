import { Router, type IRouter } from "express";
import {
  db,
  usersTable,
  contactsTable,
  existingCustomersTable,
  dealsTable,
  ordersTable,
  activitiesTable,
} from "@workspace/db";
import { eq, and, or, inArray, desc } from "drizzle-orm";
import { requireAuth, requireRole, logAudit } from "../middlewares/auth";

const router: IRouter = Router();

// ── GET /admin/user-records/:userId ──
// Fetches all active records owned/assigned to the specified user
router.get(
  "/admin/user-records/:userId",
  requireAuth,
  requireRole("admin"),
  async (req, res) => {
    try {
      const userId = Number(req.params.userId);
      if (!userId || isNaN(userId)) {
        res.status(400).json({ error: "Invalid user ID" });
        return;
      }

      // 1. Leads / Contacts
      const contacts = await db
        .select({
          id: contactsTable.id,
          name: contactsTable.name,
          companyName: contactsTable.companyName,
          mobile: contactsTable.mobile,
          category: contactsTable.category,
          unit: contactsTable.unit,
          createdAt: contactsTable.createdAt,
        })
        .from(contactsTable)
        .where(eq(contactsTable.salesOwnerId, userId))
        .orderBy(desc(contactsTable.createdAt));

      // 2. Existing Customers
      const customers = await db
        .select({
          id: existingCustomersTable.id,
          contactId: existingCustomersTable.contactId,
          salesOwnerId: existingCustomersTable.salesOwnerId,
          supportOwnerId: existingCustomersTable.supportOwnerId,
          status: existingCustomersTable.status,
          createdAt: existingCustomersTable.createdAt,
          customerName: contactsTable.name,
          companyName: contactsTable.companyName,
          mobile: contactsTable.mobile,
        })
        .from(existingCustomersTable)
        .leftJoin(contactsTable, eq(existingCustomersTable.contactId, contactsTable.id))
        .where(
          or(
            eq(existingCustomersTable.salesOwnerId, userId),
            eq(existingCustomersTable.supportOwnerId, userId)
          )
        )
        .orderBy(desc(existingCustomersTable.createdAt));

      // 3. Deals
      const deals = await db
        .select({
          id: dealsTable.id,
          title: dealsTable.title,
          stage: dealsTable.stage,
          totalValue: dealsTable.totalValue,
          wonAmount: dealsTable.wonAmount,
          contactId: dealsTable.contactId,
          customerName: contactsTable.name,
          companyName: contactsTable.companyName,
          createdAt: dealsTable.createdAt,
        })
        .from(dealsTable)
        .leftJoin(contactsTable, eq(dealsTable.contactId, contactsTable.id))
        .where(eq(dealsTable.salesOwnerId, userId))
        .orderBy(desc(dealsTable.createdAt));

      // 4. Orders
      const orders = await db
        .select({
          id: ordersTable.id,
          orderNumber: ordersTable.orderNumber,
          customerName: ordersTable.customerName,
          companyName: ordersTable.companyName,
          status: ordersTable.status,
          grandTotal: ordersTable.grandTotal,
          salesOwnerId: ordersTable.salesOwnerId,
          supportOwnerId: ordersTable.supportOwnerId,
          productionOwnerId: ordersTable.productionOwnerId,
          createdAt: ordersTable.createdAt,
        })
        .from(ordersTable)
        .where(
          and(
            eq(ordersTable.isDeleted, false),
            or(
              eq(ordersTable.salesOwnerId, userId),
              eq(ordersTable.supportOwnerId, userId),
              eq(ordersTable.productionOwnerId, userId)
            )
          )
        )
        .orderBy(desc(ordersTable.createdAt));

      res.json({
        contacts,
        customers,
        deals,
        orders,
        summary: {
          contactsCount: contacts.length,
          customersCount: customers.length,
          dealsCount: deals.length,
          ordersCount: orders.length,
        },
      });
    } catch (err) {
      console.error("Fetch user records error:", err);
      res.status(500).json({ error: "Failed to fetch user records" });
    }
  }
);

// ── POST /admin/reassign-data ──
// Reassigns selected records from source user to target user
router.post(
  "/admin/reassign-data",
  requireAuth,
  requireRole("admin"),
  async (req, res) => {
    try {
      const { sourceUserId, targetUserId, selectedIds } = req.body as {
        sourceUserId: number;
        targetUserId: number;
        selectedIds?: {
          contacts?: number[];
          customers?: number[];
          deals?: number[];
          orders?: number[];
        };
      };

      const sourceId = Number(sourceUserId);
      const targetId = Number(targetUserId);

      if (!sourceId || isNaN(sourceId) || !targetId || isNaN(targetId)) {
        res.status(400).json({ error: "Source and Target User IDs are required" });
        return;
      }

      if (sourceId === targetId) {
        res.status(400).json({ error: "Source and target user must be different" });
        return;
      }

      // Verify target user exists
      const [targetUser] = await db
        .select({ id: usersTable.id, name: usersTable.name, isActive: usersTable.isActive })
        .from(usersTable)
        .where(eq(usersTable.id, targetId));

      if (!targetUser) {
        res.status(404).json({ error: "Target user not found" });
        return;
      }

      if (!targetUser.isActive) {
        res.status(400).json({ error: "Target user is inactive" });
        return;
      }

      const selectedContacts = (selectedIds?.contacts || []).map(Number).filter((id): id is number => !isNaN(id) && id > 0);
      const selectedCustomers = (selectedIds?.customers || []).map(Number).filter((id): id is number => !isNaN(id) && id > 0);
      const selectedDeals = (selectedIds?.deals || []).map(Number).filter((id): id is number => !isNaN(id) && id > 0);
      const selectedOrders = (selectedIds?.orders || []).map(Number).filter((id): id is number => !isNaN(id) && id > 0);

      const totalSelected = selectedContacts.length + selectedCustomers.length + selectedDeals.length + selectedOrders.length;
      if (totalSelected === 0) {
        res.status(400).json({ error: "No records selected for reassignment" });
        return;
      }

      // Execute safe batch updates inside database transaction
      await db.transaction(async (tx) => {
        // 1. Reassign Contacts
        if (selectedContacts.length > 0) {
          await tx
            .update(contactsTable)
            .set({ salesOwnerId: targetId, updatedAt: new Date() })
            .where(
              and(
                inArray(contactsTable.id, selectedContacts),
                eq(contactsTable.salesOwnerId, sourceId)
              )
            );
        }

        // 2. Reassign Existing Customers
        if (selectedCustomers.length > 0) {
          // If source was sales owner
          await tx
            .update(existingCustomersTable)
            .set({ salesOwnerId: targetId, updatedAt: new Date() })
            .where(
              and(
                inArray(existingCustomersTable.id, selectedCustomers),
                eq(existingCustomersTable.salesOwnerId, sourceId)
              )
            );

          // If source was support owner
          await tx
            .update(existingCustomersTable)
            .set({ supportOwnerId: targetId, updatedAt: new Date() })
            .where(
              and(
                inArray(existingCustomersTable.id, selectedCustomers),
                eq(existingCustomersTable.supportOwnerId, sourceId)
              )
            );
        }

        // 3. Reassign Deals
        if (selectedDeals.length > 0) {
          await tx
            .update(dealsTable)
            .set({ salesOwnerId: targetId, updatedAt: new Date() })
            .where(
              and(
                inArray(dealsTable.id, selectedDeals),
                eq(dealsTable.salesOwnerId, sourceId)
              )
            );
        }

        // 4. Reassign Orders
        if (selectedOrders.length > 0) {
          // If source was sales owner
          await tx
            .update(ordersTable)
            .set({ salesOwnerId: targetId, updatedAt: new Date() })
            .where(
              and(
                inArray(ordersTable.id, selectedOrders),
                eq(ordersTable.salesOwnerId, sourceId)
              )
            );

          // If source was support owner
          await tx
            .update(ordersTable)
            .set({ supportOwnerId: targetId, updatedAt: new Date() })
            .where(
              and(
                inArray(ordersTable.id, selectedOrders),
                eq(ordersTable.supportOwnerId, sourceId)
              )
            );

          // If source was production owner
          await tx
            .update(ordersTable)
            .set({ productionOwnerId: targetId, updatedAt: new Date() })
            .where(
              and(
                inArray(ordersTable.id, selectedOrders),
                eq(ordersTable.productionOwnerId, sourceId)
              )
            );
        }

        // 5. Reassign Activities associated with transferred contacts or deals
        if (selectedContacts.length > 0 || selectedDeals.length > 0) {
          const actConditions = [];
          if (selectedContacts.length > 0) {
            actConditions.push(inArray(activitiesTable.contactId, selectedContacts));
          }
          if (selectedDeals.length > 0) {
            actConditions.push(inArray(activitiesTable.dealId, selectedDeals));
          }

          if (actConditions.length > 0) {
            await tx
              .update(activitiesTable)
              .set({ assignedTo: targetId, updatedAt: new Date() })
              .where(
                and(
                  eq(activitiesTable.assignedTo, sourceId),
                  or(...actConditions)
                )
              );
          }
        }
      });

      // Audit Log
      try {
        await logAudit(
          "user_data_reassignment",
          sourceId,
          "reassign",
          { fromUserId: sourceId },
          {
            toUserId: targetId,
            reassignedCounts: {
              contacts: selectedContacts.length,
              customers: selectedCustomers.length,
              deals: selectedDeals.length,
              orders: selectedOrders.length,
            },
          },
          req.user!.id,
          "admin",
          "admin",
          `Reassigned ${totalSelected} records from user #${sourceId} to user #${targetId}`
        );
      } catch (auditErr) {
        console.error("Audit log error on reassignment:", auditErr);
      }

      res.json({
        success: true,
        message: `Successfully reassigned ${totalSelected} records to ${targetUser.name}`,
        counts: {
          contacts: selectedContacts.length,
          customers: selectedCustomers.length,
          deals: selectedDeals.length,
          orders: selectedOrders.length,
          total: totalSelected,
        },
      });
    } catch (err) {
      console.error("Reassign data error:", err);
      res.status(500).json({ error: "Failed to reassign records" });
    }
  }
);

export default router;
