import { NextResponse } from "next/server";
import { buildExportFromDoc } from "@/lib/model/to-export";
import { renderExportMarkdown, validateExport, countBySeverity } from "@/lib/export";
import { getStore, isUuid } from "@/lib/server";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ tripId: string }> };

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * 読み取り専用サマリーページ `/trip/[tripId]/summary`（第5.2章）
 * - ログイン不要・パスコード不要で AI（Muse）が直接 Web 閲覧して読み取れる
 * - `?format=json` の場合は `Content-Type: application/json` で生 JSON を返却（JavaScript 実行不要）
 * - 既定表示または `?format=md` の場合は人間向け Markdown 要約 HTML と共に
 *   `<script type="application/json" id="voyage-export">...</script>` をサーバー描画で埋め込む
 */
export async function GET(req: Request, { params }: Ctx) {
  const { tripId } = await params;
  if (!isUuid(tripId)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const doc = await getStore().getTripDoc(tripId);
  if (!doc) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const exported = buildExportFromDoc(doc);
  const url = new URL(req.url);
  const format = url.searchParams.get("format");

  // 1. ?format=json → Content-Type: application/json で生JSONを返す
  if (format === "json") {
    return new NextResponse(JSON.stringify(exported, null, 2), {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        "Access-Control-Allow-Origin": "*",
      },
    });
  }

  // 2. 既定表示 / ?format=md → 人間向けMarkdown要約 + <script type="application/json" id="voyage-export">
  const md = renderExportMarkdown(exported);
  const validation = validateExport(exported);
  const counts = countBySeverity(validation.issues);
  const safeJsonForScript = JSON.stringify(exported, null, 2).replace(/<\//g, "<\\/");
  const jsonEndpoint = `/trip/${tripId}/summary?format=json`;
  const tripUrl = `/trip/${tripId}`;

  const html = `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(exported.trip.title || "Voyage Summary")} — Muse連携サマリー</title>
  <style>
    :root {
      color-scheme: light;
      font-family: -apple-system, BlinkMacSystemFont, "Hiragino Sans", "Noto Sans JP", sans-serif;
    }
    body {
      margin: 0;
      background: #f8fafc;
      color: #0f172a;
      line-height: 1.65;
    }
    .container {
      max-width: 860px;
      margin: 0 auto;
      padding: 24px 16px 64px;
    }
    .header-card {
      background: #ffffff;
      border: 1px solid #e2e8f0;
      border-radius: 16px;
      padding: 20px;
      margin-bottom: 20px;
      box-shadow: 0 1px 3px rgba(15, 23, 42, 0.04);
    }
    .badge {
      display: inline-block;
      padding: 2px 10px;
      border-radius: 9999px;
      font-size: 12px;
      font-weight: 700;
      background: #eff6ff;
      color: #1d4ed8;
    }
    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-top: 12px;
    }
    .btn {
      display: inline-block;
      padding: 8px 14px;
      border-radius: 10px;
      font-size: 13px;
      font-weight: 600;
      text-decoration: none;
      background: #2563eb;
      color: #ffffff;
    }
    .btn.secondary {
      background: #f1f5f9;
      color: #334155;
    }
    .card {
      background: #ffffff;
      border: 1px solid #e2e8f0;
      border-radius: 16px;
      padding: 20px;
      margin-bottom: 20px;
    }
    pre {
      background: #0f172a;
      color: #f8fafc;
      padding: 16px;
      border-radius: 12px;
      overflow-x: auto;
      font-size: 12px;
      line-height: 1.5;
      white-space: pre-wrap;
      word-break: break-word;
    }
    .issues {
      margin: 0;
      padding-left: 18px;
      font-size: 13px;
    }
    .issues li {
      margin-bottom: 4px;
    }
  </style>
</head>
<body>
  <script type="application/json" id="voyage-export">${safeJsonForScript}</script>
  <main class="container">
    <section class="header-card">
      <span class="badge">Muse AI 連携用・読み取り専用サマリー (schema_version ${escapeHtml(exported.schema_version)})</span>
      <h1 style="margin: 10px 0 4px; font-size: 22px;">${escapeHtml(exported.trip.title)}</h1>
      <p style="margin: 0; font-size: 13px; color: #64748b;">
        このページはログイン・パスコード不要で読み取れます。AI（Muse）は <code>?format=json</code> またはページ内の <code>#voyage-export</code> から構造化JSONを取得してください。
      </p>
      <div class="actions">
        <a class="btn" href="${escapeHtml(jsonEndpoint)}">生JSONを表示 (?format=json)</a>
        <a class="btn secondary" href="${escapeHtml(tripUrl)}">しおり編集画面へ戻る</a>
      </div>
    </section>

    ${
      validation.issues.length > 0
        ? `<section class="card" style="border-color: #fde68a; background: #fffbeb;">
      <h2 style="margin-top:0; font-size: 15px; color: #92400e;">
        ⚠️ バリデーション通知（エラー ${counts.error}件 / 警告 ${counts.warning}件 / 確認推奨 ${counts.info}件）
      </h2>
      <ul class="issues">
        ${validation.issues
          .map(
            (iss) =>
              `<li><strong>[${escapeHtml(iss.severity.toUpperCase())}]</strong> <code>${escapeHtml(
                iss.path,
              )}</code>: ${escapeHtml(iss.message)}</li>`,
          )
          .join("\n")}
      </ul>
    </section>`
        : ""
    }

    <section class="card">
      <h2 style="margin-top: 0; font-size: 16px;">Markdown 要約（人間向け目視確認用）</h2>
      <pre>${escapeHtml(md)}</pre>
    </section>
  </main>
</body>
</html>`;

  return new NextResponse(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
