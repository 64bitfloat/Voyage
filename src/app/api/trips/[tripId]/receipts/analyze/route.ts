import { NextResponse } from "next/server";
import { z } from "zod";
import { getClientIp, isUuid, jsonError, parseBody, requireTripWriteAccess, getStore } from "@/lib/server";
import { checkRateLimit } from "@/lib/server/passcode";
import {
  AZURE_F0_MAX_BYTES,
  ReceiptAnalysisError,
  analyzeReceiptImage,
  validateAzureCredentials,
  verifyDeveloperPasscode,
} from "@/lib/server/receipt-ocr";

type Ctx = { params: Promise<{ tripId: string }> };

export const runtime = "nodejs";
export const maxDuration = 60;

/** 画像1枚（data URL）。F0 の上限 4MB（base64 では約 5.6MB）以内 */
const AnalyzeInput = z.object({
  image: z
    .string()
    .max(Math.ceil((AZURE_F0_MAX_BYTES * 4) / 3) + 64)
    .regex(/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/, "画像の data URL を指定してください"),
  mode: z.enum(["developer", "custom_azure"]).default("developer"),
  developerPasscode: z.string().max(128).optional(),
  customEndpoint: z.string().max(512).optional(),
  customKey: z.string().max(512).optional(),
});

/**
 * POST /api/trips/:tripId/receipts/analyze
 * レシート画像を Azure AI Document Intelligence（prebuilt-receipt）で読み取り、項目の下書きを返す。
 * - mode === "developer": 合言葉 (developerPasscode) が一致したときのみサーバー環境変数の Azure 枠を使用する
 * - mode === "custom_azure": ユーザー自身が指定した customEndpoint / customKey で解析する
 */
export async function POST(req: Request, { params }: Ctx) {
  const { tripId } = await params;
  if (!isUuid(tripId)) return jsonError(404, "旅行が見つかりません");
  const denied = await requireTripWriteAccess(req, tripId);
  if (denied) return denied;
  if (!(await getStore().getTripDoc(tripId))) return jsonError(404, "旅行が見つかりません");

  // 無料枠の浪費防止: 1IPあたり 10分で20枚まで
  if (!checkRateLimit(`receipt-ocr:${getClientIp(req)}`, 20, 10 * 60 * 1000)) {
    return jsonError(429, "短時間に読み取りが集中しています。しばらく待つか、項目を手入力してください。", {
      code: "rate_limited",
    });
  }

  const body = await parseBody(req, AnalyzeInput);
  if (!body.ok) return body.res;

  let customCreds = null;
  if (body.data.mode === "custom_azure") {
    customCreds = validateAzureCredentials(body.data.customEndpoint, body.data.customKey);
    if (!customCreds) {
      return jsonError(
        400,
        "自前Azureモードのエンドポイント（https://xxxx.cognitiveservices.azure.com/）またはAPIキーが正しく入力されていません。設定画面を確認してください。",
        { code: "invalid_custom_config" },
      );
    }
  } else {
    // 開発者モード: 合言葉が一致しない場合はサーバーのAzure枠を消費させない
    if (!verifyDeveloperPasscode(body.data.developerPasscode)) {
      return jsonError(
        403,
        "開発者モードの合言葉が一致しません。サイドバー「設定」から合言葉を確認するか、標準の「ブラウザ内OCR」をご利用ください。",
        { code: "unauthorized" },
      );
    }
  }

  const base64 = body.data.image.slice(body.data.image.indexOf(",") + 1);

  try {
    const result = await analyzeReceiptImage(base64, customCreds);
    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof ReceiptAnalysisError) {
      const status =
        e.code === "not_configured"
          ? 503
          : e.code === "unauthorized"
            ? 401
            : e.code === "invalid_custom_config"
              ? 400
              : e.code === "quota"
                ? 429
                : e.code === "too_large"
                  ? 413
                  : 502;
      return jsonError(status, e.message, { code: e.code });
    }
    console.error("[voyage] receipt analyze", e);
    return jsonError(502, "レシートの読み取りに失敗しました。項目を手入力してください。", { code: "upstream" });
  }
}
