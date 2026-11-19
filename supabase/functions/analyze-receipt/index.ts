/**
 * Supabase Edge Function: analyze-receipt
 *
 * Azure AI Document Intelligence (prebuilt-receipt) を呼び出し、レシート画像（1枚・4MB以下）を構造化解析する。
 *
 * 必要な Supabase Secrets:
 *   supabase secrets set AZURE_DOC_INTELLIGENCE_ENDPOINT=https://<resource>.cognitiveservices.azure.com/
 *   supabase secrets set AZURE_DOC_INTELLIGENCE_KEY=<your-f0-key>
 *
 * ※ Next.js 側の環境変数（.env.local / Vercel）に同じ変数を設定した場合は
 *    Next.js サーバールート `/api/trips/[tripId]/receipts/analyze` が直接 Azure を呼び出し、
 *    Supabase Secrets 側にのみ設定した場合は本 Edge Function へ転送される。
 */

const API_VERSION = "2024-11-30";
const AZURE_F0_MAX_BYTES = 4 * 1024 * 1024;

type AzureField = {
  type?: string;
  valueString?: string;
  valueNumber?: number;
  valueInteger?: number;
  valueCurrency?: { amount?: number; currencyCode?: string };
  valueArray?: AzureField[];
  valueObject?: Record<string, AzureField>;
  content?: string;
};

function num(f: AzureField | undefined): number | null {
  if (!f) return null;
  const v = f.valueCurrency?.amount ?? f.valueNumber ?? f.valueInteger;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (f.content) {
    const m = f.content.replace(/[,，¥￥円\s]/g, "").match(/^-?\d+(\.\d+)?$/);
    if (m) return Number(m[0]);
  }
  return null;
}

function str(f: AzureField | undefined): string | null {
  if (!f) return null;
  return (f.valueString ?? f.content ?? "").trim() || null;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

// Deno.serve (Supabase Edge Functions runtime)
declare const Deno: {
  env: { get(key: string): string | undefined };
  serve(handler: (req: Request) => Promise<Response> | Response): void;
};

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return jsonResponse(405, { error: "Method Not Allowed" });
  }

  const rawEndpoint = Deno.env.get("AZURE_DOC_INTELLIGENCE_ENDPOINT")?.trim();
  const key = Deno.env.get("AZURE_DOC_INTELLIGENCE_KEY")?.trim();
  if (!rawEndpoint || !key) {
    return jsonResponse(503, {
      code: "not_configured",
      error:
        "レシート読み取りが未設定です（AZURE_DOC_INTELLIGENCE_ENDPOINT / AZURE_DOC_INTELLIGENCE_KEY）。項目を手入力してください。",
    });
  }

  let endpointOrigin: string;
  try {
    const u = new URL(rawEndpoint);
    const okHost =
      u.hostname.endsWith(".cognitiveservices.azure.com") || u.hostname.endsWith(".api.cognitive.microsoft.com");
    if (u.protocol !== "https:" || !okHost) throw new Error("invalid host");
    endpointOrigin = u.origin;
  } catch {
    return jsonResponse(503, {
      code: "not_configured",
      error: "AZURE_DOC_INTELLIGENCE_ENDPOINT の形式が不正です。項目を手入力してください。",
    });
  }

  let base64 = "";
  try {
    const body = (await req.json()) as { base64Source?: string; image?: string };
    const raw = body.base64Source ?? body.image ?? "";
    base64 = raw.includes(",") ? raw.slice(raw.indexOf(",") + 1) : raw;
  } catch {
    return jsonResponse(400, { code: "bad_image", error: "リクエストボディを解釈できません。" });
  }

  const bytes = Math.floor((base64.length * 3) / 4);
  if (!base64 || bytes > AZURE_F0_MAX_BYTES) {
    return jsonResponse(413, { code: "too_large", error: "画像サイズが4MBを超えています。" });
  }

  const analyzeUrl = `${endpointOrigin}/documentintelligence/documentModels/prebuilt-receipt:analyze?api-version=${API_VERSION}&locale=ja-JP`;
  const startRes = await fetch(analyzeUrl, {
    method: "POST",
    headers: { "Ocp-Apim-Subscription-Key": key, "Content-Type": "application/json" },
    body: JSON.stringify({ base64Source: base64 }),
  }).catch(() => null);

  if (!startRes) {
    return jsonResponse(502, { code: "timeout", error: "読み取りサービスに接続できませんでした。項目を手入力してください。" });
  }
  if (startRes.status !== 202) {
    const text = (await startRes.text().catch(() => "")).toLowerCase();
    if (startRes.status === 429 || (startRes.status === 403 && (text.includes("quota") || text.includes("out of call volume")))) {
      return jsonResponse(429, {
        code: "quota",
        error:
          "読み取りサービスの無料枠（月500ページ）の上限、または一時的な回数制限に達しました。お手数ですが項目を手入力してください。",
      });
    }
    return jsonResponse(502, { code: "upstream", error: "レシートの読み取りに失敗しました。項目を手入力してください。" });
  }

  const opLocation = startRes.headers.get("operation-location");
  if (!opLocation || new URL(opLocation).origin !== endpointOrigin) {
    return jsonResponse(502, { code: "upstream", error: "読み取りサービスから不正な応答がありました。" });
  }

  const deadline = Date.now() + 30_000;
  let wait = 800;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, wait));
    wait = Math.min(wait + 400, 2000);
    const res = await fetch(opLocation, {
      headers: { "Ocp-Apim-Subscription-Key": key },
    }).catch(() => null);
    if (!res) continue;
    if (!res.ok) {
      return jsonResponse(502, { code: "upstream", error: "レシートの読み取りに失敗しました。項目を手入力してください。" });
    }
    const json = (await res.json()) as {
      status?: string;
      analyzeResult?: { documents?: { fields?: Record<string, AzureField> }[] };
    };
    if (json.status === "succeeded") {
      const fields = json.analyzeResult?.documents?.[0]?.fields ?? {};
      const items = (fields.Items?.valueArray ?? [])
        .map((it) => {
          const o = it.valueObject ?? {};
          const quantity = num(o.Quantity);
          const amount = num(o.TotalPrice) ?? (quantity === null || quantity === 1 ? num(o.Price) : null);
          return {
            name: (str(o.Description) ?? str(o.ProductCode) ?? it.content ?? "").slice(0, 200),
            quantity,
            amount_jpy: amount === null ? null : Math.round(amount),
          };
        })
        .filter((it) => it.name || it.amount_jpy !== null)
        .slice(0, 200);
      const round = (v: number | null) => (v === null ? null : Math.round(v));
      return jsonResponse(200, {
        merchant: str(fields.MerchantName)?.slice(0, 200) ?? null,
        items,
        total_jpy: round(num(fields.Total)),
        subtotal_jpy: round(num(fields.Subtotal)),
        tax_jpy: round(num(fields.TotalTax)),
      });
    }
    if (json.status === "failed") {
      return jsonResponse(502, { code: "bad_image", error: "画像を読み取れませんでした。項目を手入力してください。" });
    }
  }

  return jsonResponse(504, { code: "timeout", error: "読み取りがタイムアウトしました。項目を手入力してください。" });
});

export {};
