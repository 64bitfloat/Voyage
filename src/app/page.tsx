import { validateExport, countBySeverity, SCHEMA_VERSION } from "@/lib/export";
import { SAMPLE_EXPORT } from "@/lib/export/sample";

/** 段階1: スキーマ動作確認用の仮トップページ（段階2でしおり作成画面に置き換える） */
export default function Home() {
  const result = validateExport(SAMPLE_EXPORT);
  const counts = countBySeverity(result.issues);
  return (
    <main className="mx-auto max-w-md p-6 space-y-4">
      <h1 className="text-2xl font-bold">Voyage</h1>
      <p className="text-sm opacity-70">Muse連携データ契約 schema_version {SCHEMA_VERSION}</p>
      <div className="rounded-lg border p-4 text-sm">
        <p>サンプルJSON検証: {result.schemaValid ? "✅ スキーマ適合" : "❌ スキーマ不適合"}</p>
        <p>
          エラー {counts.error} / 警告 {counts.warning} / 情報 {counts.info}
        </p>
      </div>
    </main>
  );
}
