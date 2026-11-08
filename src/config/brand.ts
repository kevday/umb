import { z } from "zod";

const env = z
  .object({
    APP_NAME: z.string().min(1).default("[Nome da rede]"),
    APP_SLUG: z.string().regex(/^[a-z0-9-]+$/).default("rede"),
    APP_DOMAIN: z.string().default("localhost:3000"),
    APP_MAIL_FROM: z.string().default("no-reply@localhost"),
  })
  .parse(process.env);

/** Único ponto onde o nome do produto existe. */
export const brand = {
  name: env.APP_NAME,
  slug: env.APP_SLUG,
  domain: env.APP_DOMAIN,
  mailFrom: env.APP_MAIL_FROM,
} as const;
