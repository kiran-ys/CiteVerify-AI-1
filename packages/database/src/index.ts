import { PrismaLibSql } from "@prisma/adapter-libsql";
import { PrismaClient } from "./generated/prisma/client.ts";
import { resolveDatabaseUrl } from "./url.ts";

export const prisma = new PrismaClient({
  adapter: new PrismaLibSql({ url: resolveDatabaseUrl() }),
});

export * from "./generated/prisma/client.ts";
