import "server-only";

/**
 * Azure AI Document Intelligence（prebuilt-receipt）でレシート画像を解析する。
 * - エンドポイントとキーはサーバー側の環境変数のみで保持し、クライアントへ露出させない。
 *     AZURE_DOC_INTELLIGENCE_ENDPOINT  例: https://<resource>.cognitiveservices.azure.com/
 *     AZURE_DOC_INTELLIGENCE_KEY
 * - 無料枠（F0）前提: 1リクエスト=画像1枚、4MB以下。月500ページ上限超過時は quota エラーを返す。
 * - S0 への切り替えはこのコードでは一切行わない（Azure ポータルでユーザーが判断する）。
 */

const API_VERSION = "2024-11-30";
export const AZURE_F0_MAX_BYTES = 4 * 1024 * 1024;

export interface ReceiptAnalysisItem {
  name: string;
  quantity: number | null;
  /** 行の合計金額（TotalPrice。単価×数量の再計算はしない） */
  amount_jpy: number | null;
}

export interface ReceiptAnalysisResult {
  merchant: string | null;
  items: ReceiptAnalysisItem[];
  total_jpy: number | null;
  subtotal_jpy: number | null;
  tax_jpy: number | null;
}

export type ReceiptAnalysisErrorCode = "not_configured" | "quota" | "too_large" | "bad_image" | "timeout" | "upstream";

export class ReceiptAnalysisError extends Error {
  constructor(
    public code: ReceiptAnalysisErrorCode,
    message: string,
  ) {
    super(message);
  }
}

function getConfig(): { endpoint: string; key: string } | null {
  const endpoint = process.env.AZURE_DOC_INTELLIGENCE_ENDPOINT?.trim();
  const key = process.env.AZURE_DOC_INTELLIGENCE_KEY?.trim();
  if (!endpoint || !key) return null;
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return null;
  }
  // 誤設定によるキーの外部送信を防ぐため、Azure のドメインのみ許可
  const okHost =
    url.hostname.endsWith(".cognitiveservices.azure.com") || url.hostname.endsWith(".api.cognitive.microsoft.com");
  if (url.protocol !== "https:" || !okHost) return null;
  return { endpoint: url.origin, key };
}

export function isReceiptAnalysisConfigured(): boolean {
  return getConfig() !== null;
}

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

function mapError(status: number, bodyText: string): ReceiptAnalysisError {
  const t = bodyText.toLowerCase();
  if (status === 429 || (status === 403 && (t.includes("quota") || t.includes("out of call volume")))) {
    return new ReceiptAnalysisError(
      "quota",
      "読み取りサービスの無料枠（月500ページ）の上限、または一時的な回数制限に達しました。お手数ですが項目を手入力してください。",
    );
  }
  if (status === 413 || t.includes("too large") || t.includes("invalidcontentlength")) {
    return new ReceiptAnalysisError("too_large", "画像サイズが大きすぎます（4MBまで）。");
  }
  if (status === 400 && (t.includes("invalidcontent") || t.includes("unsupported") || t.includes("corrupted"))) {
    return new ReceiptAnalysisError("bad_image", "画像を読み取れませんでした。レシート全体が写った明るい画像でお試しください。");
  }
  return new ReceiptAnalysisError("upstream", "レシートの読み取りに失敗しました。項目を手入力してください。");
}

/** base64（data URL 部分を除いたもの）を受け取り解析する */
export async function analyzeReceiptImage(base64: string): Promise<ReceiptAnalysisResult> {
  const bytes = Math.floor((base64.length * 3) / 4);
  if (bytes > AZURE_F0_MAX_BYTES) {
    throw new ReceiptAnalysisError("too_large", "画像サイズが4MBを超えています。");
  }

  const cfg = getConfig();
  if (!cfg) {
    // Next.js 側の環境変数が未設定で、Supabase Edge Function (analyze-receipt) が利用可能な場合はそちらへ委譲
    const sbUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL)?.trim();
    const sbKey = (
      process.env.SUPABASE_SERVICE_ROLE_KEY ||
      process.env.SUPABASE_SECRET_KEY ||
      process.env.SUPABASE_ANON_KEY ||
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    )?.trim();
    if (sbUrl && sbKey) {
      const fnUrl = `${sbUrl.replace(/\/+$/, "")}/functions/v1/analyze-receipt`;
      const fnRes = await fetch(fnUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${sbKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ base64Source: base64 }),
        signal: AbortSignal.timeout(40_000),
      }).catch(() => null);
      if (fnRes) {
        if (fnRes.ok) {
          return (await fnRes.json()) as ReceiptAnalysisResult;
        }
        if (fnRes.status !== 404) {
          const errJson = (await fnRes.json().catch(() => null)) as {
            code?: ReceiptAnalysisErrorCode;
            error?: string;
          } | null;
          throw new ReceiptAnalysisError(
            errJson?.code ?? (fnRes.status === 429 ? "quota" : "upstream"),
            errJson?.error ?? "レシートの読み取りに失敗しました。項目を手入力してください。",
          );
        }
      }
    }

    throw new ReceiptAnalysisError(
      "not_configured",
      "レシート読み取りが未設定です（サーバーの環境変数 AZURE_DOC_INTELLIGENCE_ENDPOINT / AZURE_DOC_INTELLIGENCE_KEY）。項目を手入力してください。",
    );
  }

  const analyzeUrl = `${cfg.endpoint}/documentintelligence/documentModels/prebuilt-receipt:analyze?api-version=${API_VERSION}&locale=ja-JP`;
  const startRes = await fetch(analyzeUrl, {
    method: "POST",
    headers: { "Ocp-Apim-Subscription-Key": cfg.key, "Content-Type": "application/json" },
    body: JSON.stringify({ base64Source: base64 }),
    signal: AbortSignal.timeout(20_000),
    redirect: "error",
  }).catch(() => {
    throw new ReceiptAnalysisError("timeout", "読み取りサービスに接続できませんでした。項目を手入力してください。");
  });
  if (startRes.status !== 202) {
    throw mapError(startRes.status, await startRes.text().catch(() => ""));
  }
  const opLocation = startRes.headers.get("operation-location");
  if (!opLocation || new URL(opLocation).origin !== cfg.endpoint) {
    throw new ReceiptAnalysisError("upstream", "読み取りサービスから不正な応答がありました。");
  }

  // 結果をポーリング（最大 ~30 秒）
  const deadline = Date.now() + 30_000;
  let wait = 800;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, wait));
    wait = Math.min(wait + 400, 2000);
    const res = await fetch(opLocation, {
      headers: { "Ocp-Apim-Subscription-Key": cfg.key },
      signal: AbortSignal.timeout(10_000),
      redirect: "error",
    }).catch(() => null);
    if (!res) continue;
    if (!res.ok) throw mapError(res.status, await res.text().catch(() => ""));
    const json = (await res.json()) as {
      status?: string;
      error?: { code?: string; message?: string };
      analyzeResult?: { documents?: { fields?: Record<string, AzureField> }[] };
    };
    if (json.status === "succeeded") return parseResult(json.analyzeResult?.documents?.[0]?.fields ?? {});
    if (json.status === "failed") {
      throw mapError(400, `${json.error?.code ?? ""} ${json.error?.message ?? ""}`);
    }
  }
  throw new ReceiptAnalysisError("timeout", "読み取りがタイムアウトしました。項目を手入力してください。");
}

function parseResult(fields: Record<string, AzureField>): ReceiptAnalysisResult {
  const items: ReceiptAnalysisItem[] = (fields.Items?.valueArray ?? [])
    .map((it) => {
      const o = it.valueObject ?? {};
      const quantity = num(o.Quantity);
      // 行の合計金額（TotalPrice）を使う。無い場合のみ Price（数量1の行で単価=行合計のケース）を使う
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
  return {
    merchant: str(fields.MerchantName)?.slice(0, 200) ?? null,
    items,
    total_jpy: round(num(fields.Total)),
    subtotal_jpy: round(num(fields.Subtotal)),
    tax_jpy: round(num(fields.TotalTax)),
  };
}
