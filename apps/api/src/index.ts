import { Hono } from "hono";

const app = new Hono().basePath("/api");

app.get("/health", (c) => c.json({ status: "ok" }));

export default {
  port: Number(process.env.API_PORT ?? 3001),
  fetch: app.fetch,
};
