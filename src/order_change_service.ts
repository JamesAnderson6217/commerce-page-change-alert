import { createServer } from "node:http";
import { ZodError } from "zod";
import { InfraiApiError, OrderPageWatcher, watchRequestSchema } from "./order_page_watch.js";

const apiKey = process.env.INFRAI_API_KEY;
if (!apiKey) throw new Error("Set INFRAI_API_KEY before starting the order change service.");

const watcher = new OrderPageWatcher(apiKey);

createServer(async (request, response) => {
  if (request.method !== "POST" || request.url !== "/watch") {
    response.writeHead(404, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ error: "Use POST /watch." }));
    return;
  }

  try {
    let raw = "";
    for await (const chunk of request) raw += chunk;
    const input = watchRequestSchema.parse(JSON.parse(raw));
    const result = await watcher.watch(input);
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify(result));
  } catch (error) {
    const status = error instanceof ZodError ? 400 : error instanceof InfraiApiError && error.status < 500 ? error.status : 500;
    response.writeHead(status, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ error: error instanceof Error ? error.message : "Unexpected request error" }));
  }
}).listen(3000, () => console.log("Order page watcher listening on http://localhost:3000"));
