import { defineConfig } from "prisma/config";
import { resolveDatabaseUrl } from "./src/url.ts";

export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: { url: resolveDatabaseUrl() },
});
