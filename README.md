# Voyage 旅のしおり

Next.js App Router + Tailwind CSS + Supabase で構築されたリアルタイム共同編集型の旅行しおりアプリ（Muse / Notion 連携用 JSON スキーマ `v1.0` 対応）。

## セットアップと起動

```bash
npm install
npm run dev
```

ブラウザで [http://localhost:3000](http://localhost:3000) を開きます。

## 環境変数（`.env.local`）

`.env.example` をコピーして `.env.local` を作成し、秘密情報を設定してください（`.env.local` は Git にコミットしないでください）。

### 1. Supabase（データベース・Storage・リアルタイム同期）

未設定の場合は開発用インメモリストアで動作します。

| 環境変数名 | 用途 |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase プロジェクト URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase 公開 Anon キー |
| `SUPABASE_SERVICE_ROLE_KEY` | サーバー側 API ルート用の Service Role キー |

Supabase を使用する場合は、SQL エディタまたは CLI で以下のマイグレーションを順番に適用してください：

1. `supabase/migrations/0001_init.sql`
2. `supabase/migrations/0002_cost_line_items_receipts.sql`（費用の項目 `line_items`・レシート添付 `receipts` カラムと `receipts` Storage バケット追加）

### 2. レシート読み取り（Azure AI Document Intelligence / `prebuilt-receipt`）

費用の「項目ごとに分ける」モードでレシート画像から品目・金額・合計を自動読み取りするために、Azure AI Document Intelligence の `prebuilt-receipt` モデルを使用します。

- **料金プラン**: 無料枠（**F0**: 月 500 ページまで継続無料）での作成を推奨します。アプリ側で S0（有料枠）へ自動切り替えすることはありません。
- **F0 の制約対応**:
  - 1リクエストにつき画像1枚（1ページ）ずつ送信します。
  - 送信前にクライアント側で可読性を保ったまま **4MB 以下（目標 3MB 以下）** に自動リサイズ・JPEG 圧縮します。
  - 無料枠の上限超過時や API 未設定・通信エラー時はアプリを止めず、そのまま項目エディタでの手入力へフォールバックします。
- **秘密情報の配置**: エンドポイントとキーはサーバー側でのみ保持し、クライアントへは一切露出させません。

#### 方法A: Next.js サーバー環境変数（`.env.local` / Vercel 環境変数）に設定する場合

| 環境変数名 | 説明・例 |
| --- | --- |
| `AZURE_DOC_INTELLIGENCE_ENDPOINT` | `https://<リソース名>.cognitiveservices.azure.com/` |
| `AZURE_DOC_INTELLIGENCE_KEY` | Azure Document Intelligence の API キー（KEY 1 または KEY 2） |

#### 方法B: Supabase Edge Functions（`supabase/functions/analyze-receipt`）経由で呼び出す場合

Supabase シークレットに同じ環境変数名を設定し、Edge Function をデプロイします：

```bash
supabase secrets set AZURE_DOC_INTELLIGENCE_ENDPOINT=https://<リソース名>.cognitiveservices.azure.com/
supabase secrets set AZURE_DOC_INTELLIGENCE_KEY=<APIキー>
supabase functions deploy analyze-receipt
```

Next.js のサーバールート（`POST /api/trips/[tripId]/receipts/analyze`）は、Next.js 側に Azure 環境変数があれば直接 Azure を呼び出し、未設定で Supabase が設定されていれば自動的に Supabase Edge Function `analyze-receipt` へ委譲します。

## 検証・ビルドコマンド

```bash
npm run validate:sample   # サンプルJSONのスキーマ＆バリデーション検証
npm run validate:mvp      # スケジュール計算・精算・項目導出・自動編成の統合検証
npm run build             # 本番ビルド検証
```
