import { pgTable, serial, integer, text, timestamp, boolean } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const notificationsTable = pgTable("notifications", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  title: text("title").notNull(),
  message: text("message").notNull(),
  link: text("link"),
  relatedId: integer("related_id"),
  relatedType: text("related_type"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  readAt: timestamp("read_at", { withTimezone: true }),
  notificationSeen: boolean("notification_seen").notNull().default(false),
  notificationSeenAt: timestamp("notification_seen_at", { withTimezone: true }),
  soundPlayed: boolean("sound_played").notNull().default(false),
  reminderShown: boolean("reminder_shown").notNull().default(false),
  reminderSoundPlayed: boolean("reminder_sound_played").notNull().default(false),
});
