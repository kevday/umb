import { pgTable, uuid, text, timestamp, pgEnum, jsonb, primaryKey } from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  email: text("email").notNull().unique(),
  username: text("username").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  emailVerifiedAt: timestamp("email_verified_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  deletedAt: timestamp("deleted_at"),
});

export const profiles = pgTable("profiles", {
  userId: uuid("user_id").primaryKey().references(() => users.id),
  fullName: text("full_name").notNull(),
  displayName: text("display_name"),
  bio: text("bio"),
  /** visibilidade por campo: { campo: "eu" | "amigos" | "loja" | "autorizados" } */
  visibility: jsonb("visibility").notNull().default({}),
});

export const friendshipStatus = pgEnum("friendship_status", ["pendente", "aceita", "bloqueada"]);
export const friendships = pgTable(
  "friendships",
  {
    requesterId: uuid("requester_id").notNull().references(() => users.id),
    addresseeId: uuid("addressee_id").notNull().references(() => users.id),
    status: friendshipStatus("status").notNull().default("pendente"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [primaryKey({ columns: [t.requesterId, t.addresseeId] })],
);

export const scrapbookPosts = pgTable("scrapbook_posts", {
  id: uuid("id").defaultRandom().primaryKey(),
  profileId: uuid("profile_id").notNull().references(() => users.id),
  authorId: uuid("author_id").notNull().references(() => users.id),
  body: text("body").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const communities = pgTable("communities", {
  id: uuid("id").defaultRandom().primaryKey(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  description: text("description"),
  /** Rule do ACE (contracts/access-control.ts); null = ninguém acessa */
  policy: jsonb("policy"),
  createdBy: uuid("created_by").notNull().references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
