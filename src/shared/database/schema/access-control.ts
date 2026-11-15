import { pgTable, uuid, text, integer, serial, jsonb, pgEnum, check, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { users } from "./core";
import { ts } from "./_util";
import { RITE_IDS } from "@/theme/rites";

export const memberStatus = pgEnum("member_status", ["regular", "debito", "licenciado", "suspenso", "eliminado", "falecido"]);

export const jurisdictions = pgTable("jurisdictions", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
});

export const lodges = pgTable(
  "lodges",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    jurisdictionId: uuid("jurisdiction_id").notNull().references(() => jurisdictions.id),
    name: text("name").notNull(),
    number: integer("number"),
    /** Rito da Loja (define a paleta); null = padrão */
    rite: text("rite"),
  },
  (t) => [check("lodge_rite_valid", sql`${t.rite} is null or ${t.rite} in (${sql.raw(RITE_IDS.map((r) => `'${r}'`).join(", "))})`)],
);

export const institutionalMemberships = pgTable(
  "institutional_memberships",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull().references(() => users.id),
    lodgeId: uuid("lodge_id").notNull().references(() => lodges.id),
    status: memberStatus("status").notNull().default("regular"),
    startsAt: ts("starts_at").defaultNow().notNull(),
    endsAt: ts("ends_at"),
  },
  (t) => [uniqueIndex("one_active_membership").on(t.userId).where(sql`${t.endsAt} is null`)],
);

export const invitations = pgTable("invitations", {
  id: uuid("id").defaultRandom().primaryKey(),
  lodgeId: uuid("lodge_id").notNull().references(() => lodges.id),
  email: text("email").notNull(),
  intendedDegree: integer("intended_degree").notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  createdBy: uuid("created_by").notNull().references(() => users.id),
  approvedBy: uuid("approved_by").references(() => users.id),
  expiresAt: ts("expires_at").notNull(),
  usedAt: ts("used_at"),
  usedBy: uuid("used_by").references(() => users.id),
  createdAt: ts("created_at").defaultNow().notNull(),
});

export const degreeRequests = pgTable("degree_requests", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id),
  lodgeId: uuid("lodge_id").notNull().references(() => lodges.id),
  fromDegree: integer("from_degree").notNull(),
  toDegree: integer("to_degree").notNull(),
  requestedBy: uuid("requested_by").notNull().references(() => users.id),
  status: text("status").notNull().default("pendente"),
  decidedBy: uuid("decided_by").references(() => users.id),
  decidedAt: ts("decided_at"),
  justification: text("justification"),
  createdAt: ts("created_at").defaultNow().notNull(),
});

/** Exceções à aprovação dupla, ambas auditadas: 'bootstrap' (fundador, com evidência) e 'potencia' (convite aprovado na criação pela Administração da Potência). */
export const degreeAssignments = pgTable(
  "degree_assignments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull().references(() => users.id),
    degree: integer("degree").notNull(),
    origin: text("origin").notNull().default("regular"),
    requestedBy: uuid("requested_by").notNull().references(() => users.id),
    approvedBy: uuid("approved_by").notNull().references(() => users.id),
    at: ts("at").defaultNow().notNull(),
  },
  (t) => [
    check(
      "dual_approval",
      sql`${t.origin} in ('bootstrap', 'potencia') OR (${t.approvedBy} <> ${t.requestedBy} AND ${t.approvedBy} <> ${t.userId})`,
    ),
  ],
);

export const officeAssignments = pgTable("office_assignments", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id),
  lodgeId: uuid("lodge_id").references(() => lodges.id),
  jurisdictionId: uuid("jurisdiction_id").references(() => jurisdictions.id),
  name: text("name").notNull(),
  startsAt: ts("starts_at").notNull(),
  endsAt: ts("ends_at"),
  appointedBy: uuid("appointed_by").notNull().references(() => users.id),
});

/** Append-only (trigger no banco) e encadeada por hash. */
export const accessAuditLogs = pgTable("access_audit_logs", {
  seq: serial("seq").primaryKey(),
  at: ts("at").notNull(),
  actorId: uuid("actor_id").notNull(),
  action: text("action").notNull(),
  subjectId: uuid("subject_id"),
  payload: jsonb("payload"),
  prevHash: text("prev_hash").notNull(),
  hash: text("hash").notNull(),
});
