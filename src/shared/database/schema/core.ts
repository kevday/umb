import { pgTable, uuid, text, pgEnum, jsonb, primaryKey, boolean, integer, index, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import type { Rule } from "@/contracts/access-control";
import { ts } from "./_util";

export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  email: text("email").notNull().unique(),
  username: text("username").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  emailVerifiedAt: ts("email_verified_at"),
  isTechnicalAdmin: boolean("is_technical_admin").notNull().default(false),
  failedAttempts: integer("failed_attempts").notNull().default(0),
  lockedUntil: ts("locked_until"),
  createdAt: ts("created_at").defaultNow().notNull(),
  deletedAt: ts("deleted_at"),
});

export const sessions = pgTable(
  "sessions",
  {
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
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

export const userTotp = pgTable("user_totp", {
  userId: uuid("user_id").primaryKey().references(() => users.id),
  secretEnc: text("secret_enc").notNull(),
  confirmedAt: ts("confirmed_at"),
  /** último passo de 30 s aceito: impede reuso do mesmo código */
  lastStep: integer("last_step"),
});

export const emailTokenKind = pgEnum("email_token_kind", ["verify", "reset"]);
export const emailTokens = pgTable("email_tokens", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id),
  kind: emailTokenKind("kind").notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: ts("expires_at").notNull(),
  usedAt: ts("used_at"),
});

export const profiles = pgTable(
  "profiles",
  {
    userId: uuid("user_id").primaryKey().references(() => users.id),
    fullName: text("full_name").notNull(),
    displayName: text("display_name"),
    bio: text("bio"),
    /** visibilidade por campo: { campo: "eu" | "amigos" | "loja" | "autorizados" } */
    visibility: jsonb("visibility").notNull().default({}),
    /** cor própria escolhida pelo irmão (#RRGGBB); null = segue o Rito da Loja */
    themeColor: text("theme_color"),
  },
  (t) => [check("profile_theme_hex", sql`${t.themeColor} is null or ${t.themeColor} ~ '^#[0-9a-fA-F]{6}$'`)],
);

export const friendshipStatus = pgEnum("friendship_status", ["pendente", "aceita", "bloqueada"]);
export const friendships = pgTable(
  "friendships",
  {
    requesterId: uuid("requester_id").notNull().references(() => users.id),
    addresseeId: uuid("addressee_id").notNull().references(() => users.id),
    status: friendshipStatus("status").notNull().default("pendente"),
    createdAt: ts("created_at").defaultNow().notNull(),
  },
  (t) => [primaryKey({ columns: [t.requesterId, t.addresseeId] })],
);

export const scrapbookPosts = pgTable("scrapbook_posts", {
  id: uuid("id").defaultRandom().primaryKey(),
  profileId: uuid("profile_id").notNull().references(() => users.id),
  authorId: uuid("author_id").notNull().references(() => users.id),
  body: text("body").notNull(),
  createdAt: ts("created_at").defaultNow().notNull(),
});

export const communities = pgTable("communities", {
  id: uuid("id").defaultRandom().primaryKey(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  description: text("description"),
  /** Regra do ACE (contracts/access-control.ts); null = ninguém acessa */
  policy: jsonb("policy").$type<Rule | null>(),
  createdBy: uuid("created_by").notNull().references(() => users.id),
  createdAt: ts("created_at").defaultNow().notNull(),
});

export const communityTopics = pgTable("community_topics", {
  id: uuid("id").defaultRandom().primaryKey(),
  communityId: uuid("community_id").notNull().references(() => communities.id),
  authorId: uuid("author_id").notNull().references(() => users.id),
  title: text("title").notNull(),
  body: text("body").notNull(),
  pinned: boolean("pinned").notNull().default(false),
  createdAt: ts("created_at").defaultNow().notNull(),
});

export const communityReplies = pgTable("community_replies", {
  id: uuid("id").defaultRandom().primaryKey(),
  topicId: uuid("topic_id").notNull().references(() => communityTopics.id),
  authorId: uuid("author_id").notNull().references(() => users.id),
  body: text("body").notNull(),
  createdAt: ts("created_at").defaultNow().notNull(),
});

export const reports = pgTable("reports", {
  id: uuid("id").defaultRandom().primaryKey(),
  reporterId: uuid("reporter_id").notNull().references(() => users.id),
  targetKind: text("target_kind").notNull(),
  targetId: uuid("target_id").notNull(),
  reason: text("reason").notNull(),
  status: text("status").notNull().default("aberta"),
  createdAt: ts("created_at").defaultNow().notNull(),
});

/** Janela fixa por chave (ex.: "login:<ip>"), compatível com serverless (estado no banco). */
export const rateLimits = pgTable("rate_limits", {
  key: text("key").primaryKey(),
  count: integer("count").notNull(),
  windowStart: ts("window_start").notNull(),
});
