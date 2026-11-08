import { pgTable, uuid, text, timestamp, integer, serial, jsonb, pgEnum, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { users } from "./core";

export const memberStatus = pgEnum("member_status", ["regular", "debito", "licenciado", "suspenso", "eliminado", "falecido"]);

export const jurisdictions = pgTable("jurisdictions", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
});

export const lodges = pgTable("lodges", {
  id: uuid("id").defaultRandom().primaryKey(),
  jurisdictionId: uuid("jurisdiction_id").notNull().references(() => jurisdictions.id),
  name: text("name").notNull(),
  number: integer("number"),
});

export const institutionalMemberships = pgTable("institutional_memberships", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id),
  lodgeId: uuid("lodge_id").notNull().references(() => lodges.id),
  status: memberStatus("status").notNull().default("regular"),
  startsAt: timestamp("starts_at").defaultNow().notNull(),
  endsAt: timestamp("ends_at"),
});

export const degreeAssignments = pgTable(
  "degree_assignments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull().references(() => users.id),
    degree: integer("degree").notNull(),
    requestedBy: uuid("requested_by").notNull().references(() => users.id),
    approvedBy: uuid("approved_by").notNull().references(() => users.id),
    at: timestamp("at").defaultNow().notNull(),
  },
  (t) => [
    check("dual_approval", sql`${t.approvedBy} <> ${t.requestedBy} AND ${t.approvedBy} <> ${t.userId}`),
  ],
);

export const officeAssignments = pgTable("office_assignments", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id),
  lodgeId: uuid("lodge_id").references(() => lodges.id),
  name: text("name").notNull(),
  startsAt: timestamp("starts_at").notNull(),
  endsAt: timestamp("ends_at"),
  appointedBy: uuid("appointed_by").notNull().references(() => users.id),
});

/** Append-only: ver database/rls/001_policies.sql */
export const accessAuditLogs = pgTable("access_audit_logs", {
  seq: serial("seq").primaryKey(),
  at: timestamp("at").defaultNow().notNull(),
  actorId: uuid("actor_id").notNull(),
  action: text("action").notNull(),
  subjectId: uuid("subject_id"),
  payload: jsonb("payload"),
  prevHash: text("prev_hash").notNull(),
  hash: text("hash").notNull(),
});
