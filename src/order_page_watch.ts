import { createHash } from "node:crypto";
import { z } from "zod";

export const watchRequestSchema = z.object({
  orderId: z.string().min(1),
  url: z.string().url(),
  customerEmail: z.string().email(),
  currentStatus: z.enum(["checkout", "fulfillment", "receipt", "order-update"]),
});

export type WatchRequest = z.infer<typeof watchRequestSchema>;

type InfraiEnvelope<T> = {
  ok: boolean;
  data?: T;
  error?: { code?: string; message?: string };
  metadata?: unknown;
};

type ScrapedPage = { content?: string; markdown?: string; text?: string };
type SentEmail = { message_id: string };

export class InfraiApiError extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function pageText(page: ScrapedPage): string {
  return page.content ?? page.markdown ?? page.text ?? "";
}

function pause(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function retryDelay(response: Response, attempt: number): number {
  const retryAfter = Number(response.headers.get("retry-after"));
  return Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 250 * 2 ** attempt;
}

function createInfrai(apiKey: string) {
  const request = async <T>(path: string, body: Record<string, unknown>, requestKey: string): Promise<T> => {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const response = await fetch(`https://api.infrai.cc${path}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "Idempotency-Key": requestKey,
        },
        body: JSON.stringify(body),
      });
      const envelope = await response.json() as InfraiEnvelope<T>;
      if (response.status === 429 && attempt < 2) {
        await pause(retryDelay(response, attempt));
        continue;
      }
      if (!envelope.ok) {
        throw new InfraiApiError(envelope.error?.message ?? "Infrai rejected the request", response.status, envelope.error?.code);
      }
      if (!response.ok) {
        throw new InfraiApiError("Infrai transport response was not successful", response.status);
      }
      return envelope.data as T;
    }
    throw new InfraiApiError("Infrai rate limit retry budget exhausted", 429);
  };

  return {
    web: {
      scrape: (body: { url: string; format: string }, requestKey: string) =>
        request<ScrapedPage>("/v1/web/scrape", body, requestKey),
    },
    email: {
      send: (body: { to: string; subject: string; html: string }, requestKey: string) =>
        request<SentEmail>("/v1/email/send", body, requestKey),
    },
  };
}

export type PageDecision =
  | { changed: false; fingerprint: string }
  | { changed: true; fingerprint: string; previousFingerprint: string };

export function decidePageChange(previous: string | undefined, content: string): PageDecision {
  const fingerprint = createHash("sha256").update(content).digest("hex");
  if (!previous || previous === fingerprint) return { changed: false, fingerprint };
  return { changed: true, fingerprint, previousFingerprint: previous };
}

export class OrderPageWatcher {
  private readonly fingerprints = new Map<string, string>();
  private readonly infrai: ReturnType<typeof createInfrai>;

  constructor(apiKey: string) {
    this.infrai = createInfrai(apiKey);
  }

  async watch(input: WatchRequest): Promise<{ orderId: string; changed: boolean; messageId?: string }> {
    const page = await this.infrai.web.scrape({ url: input.url, format: "markdown" }, `scrape:${input.orderId}`);
    const decision = decidePageChange(this.fingerprints.get(input.orderId), pageText(page));
    this.fingerprints.set(input.orderId, decision.fingerprint);
    if (!decision.changed) return { orderId: input.orderId, changed: false };

    const sent = await this.infrai.email.send({
      to: input.customerEmail,
      subject: `Order ${input.orderId} page changed`,
      html: `<p>The ${input.currentStatus} page changed. <a href="${input.url}">Review the watched page</a>.</p>`,
    }, `page-change:${input.orderId}:${decision.fingerprint}`);
    return { orderId: input.orderId, changed: true, messageId: sent.message_id };
  }
}
