import { pgTable, uuid, text, boolean, integer, jsonb, timestamp, primaryKey, serial } from "drizzle-orm/pg-core";

const ts = (n: string) => timestamp(n, { withTimezone: true });

export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  email: text("email").notNull().unique(),
  username: text("username").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  emailVerifiedAt: ts("email_verified_at"),
  isAdmin: boolean("is_admin").notNull().default(false),
  status: text("status").notNull().default("active"), // active | suspended
  failedAttempts: integer("failed_attempts").notNull().default(0),
  lockedUntil: ts("locked_until"),
  createdAt: ts("created_at").defaultNow().notNull(),
  deletedAt: ts("deleted_at"),
});
export const profiles = pgTable("profiles", {
  userId: uuid("user_id").primaryKey().references(() => users.id),
  fullName: text("full_name").notNull(),
  displayName: text("display_name"),
  bio: text("bio"),
});
export const sessions = pgTable("sessions", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id),
  tokenHash: text("token_hash").notNull().unique(),
  mfaVerified: boolean("mfa_verified").notNull().default(false),
  userAgent: text("user_agent"),
  ip: text("ip"),
  createdAt: ts("created_at").defaultNow().notNull(),
  lastUsedAt: ts("last_used_at").defaultNow().notNull(),
  expiresAt: ts("expires_at").notNull(),
  revokedAt: ts("revoked_at"),
});
export const userTotp = pgTable("user_totp", {
  userId: uuid("user_id").primaryKey().references(() => users.id),
  secretEnc: text("secret_enc").notNull(),
  confirmedAt: ts("confirmed_at"),
  lastStep: integer("last_step"),
});
export const recoveryCodes = pgTable("recovery_codes", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id),
  codeHash: text("code_hash").notNull(),
  usedAt: ts("used_at"),
  createdAt: ts("created_at").defaultNow().notNull(),
});
/** kind: verify | reset | email_change | mfa_reset */
export const emailTokens = pgTable("email_tokens", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id),
  kind: text("kind").notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  newEmail: text("new_email"),
  expiresAt: ts("expires_at").notNull(),
  usedAt: ts("used_at"),
});
/** Convite genérico: `payload` é interpretado pelos módulos (evento invite.consumed). */
export const invites = pgTable("invites", {
  id: uuid("id").defaultRandom().primaryKey(),
  email: text("email").notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  createdBy: uuid("created_by").references(() => users.id),
  payload: jsonb("payload").notNull().default({}),
  expiresAt: ts("expires_at").notNull(),
  usedAt: ts("used_at"),
  usedBy: uuid("used_by").references(() => users.id),
  revokedAt: ts("revoked_at"),
  createdAt: ts("created_at").defaultNow().notNull(),
});
export const rateLimits = pgTable("rate_limits", {
  key: text("key").primaryKey(),
  count: integer("count").notNull(),
  windowStart: ts("window_start").notNull(),
});
/** Estado dos módulos instalados no código. Desativar não apaga dados. */
export const modules = pgTable("modules", {
  id: text("id").primaryKey(),
  enabled: boolean("enabled").notNull().default(false),
  version: text("version"),
  updatedAt: ts("updated_at").defaultNow().notNull(),
});
/** Configurações. scope_id = '' (global) ou o id do usuário (preferência pessoal). */
export const settings = pgTable("settings", {
  module: text("module").notNull(),
  key: text("key").notNull(),
  scopeId: text("scope_id").notNull().default(""),
  value: jsonb("value").notNull(),
  updatedAt: ts("updated_at").defaultNow().notNull(),
  updatedBy: uuid("updated_by"),
}, (t) => [primaryKey({ columns: [t.module, t.key, t.scopeId] })]);
/** Somente inserção (trigger) e encadeada por hash. */
export const auditLog = pgTable("audit_log", {
  seq: serial("seq").primaryKey(),
  at: ts("at").notNull(),
  actorId: uuid("actor_id"),
  action: text("action").notNull(),
  subject: text("subject"),
  payload: jsonb("payload"),
  prevHash: text("prev_hash").notNull(),
  hash: text("hash").notNull(),
});
