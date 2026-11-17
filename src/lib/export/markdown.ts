/**
 * 副形式: 人間が目視確認するための Markdown 要約生成（第5.1・5.2章）
 * ※ Muse への受け渡しは JSON を主形式とし、Markdown は確認用。
 */
import type { VoyageExport } from "./schema";

const STATUS_JA: Record<string, string> = {
  decided: "決まった",
  candidate: "候補",
  undecided: "未定",
};

const CAT_JA: Record<string, string> = {
  sightseeing: "観光",
  onsen: "温泉",
  meal: "食事",
  lodging: "宿泊",
  transport: "移動",
  shopping: "買い物",
  other: "その他",
  food: "飲食",
  ticket: "チケット",
};

const MODE_JA: Record<string, string> = {
  car: "車",
  walk: "徒歩",
  train: "電車/バス",
  manual: "手動",
};

export function renderExportMarkdown(exp: VoyageExport): string {
  const t = exp.trip;
  const lines: string[] = [];

  lines.push(`# ${t.title || "（無題の旅行）"}`);
  lines.push("");
  lines.push(`- **Trip ID**: \`${t.id}\``);
  lines.push(`- **Schema Version**: \`${exp.schema_version}\` (\`${exp.timezone}\`)`);
  lines.push(`- **日程**: ${t.start_date ?? "未定"} 〜 ${t.end_date ?? "未定"}`);
  lines.push(`- **出力日時**: ${exp.exported_at}`);
  lines.push("");

  // スケジュール破綻警告
  if (t.schedule_conflicts.length > 0) {
    lines.push(`## ⚠️ スケジュール破綻（${t.schedule_conflicts.length}件）`);
    lines.push("");
    lines.push("| スポット | 予約時刻 | 到着予定 | 超過 |");
    lines.push("| --- | --- | --- | --- |");
    for (const c of t.schedule_conflicts) {
      lines.push(
        `| ${c.spot_name} | ${c.reservation_time} | ${c.arrival_planned} | **+${c.overrun_minutes}分** |`,
      );
    }
    lines.push("");
  }

  // 宿泊
  lines.push("## 宿泊情報");
  lines.push("");
  if (t.lodging) {
    lines.push(`- **名称**: ${t.lodging.name}`);
    lines.push(`- **住所**: ${t.lodging.address ?? "未入力"}`);
    lines.push(`- **チェックイン**: ${t.lodging.check_in ?? "未入力"}`);
    lines.push(`- **チェックアウト**: ${t.lodging.check_out ?? "未入力"}`);
  } else {
    lines.push("_未登録_");
  }
  lines.push("");

  // 参加者
  lines.push(`## 参加者（${t.participants.length}名）`);
  lines.push("");
  if (t.participants.length > 0) {
    lines.push("| 本名（Notion照合用） | ニックネーム | 役割 |");
    lines.push("| --- | --- | --- |");
    for (const p of t.participants) {
      lines.push(`| ${p.full_name || "（未入力）"} | ${p.nickname || "-"} | ${p.role || "-"} |`);
    }
  } else {
    lines.push("_未登録_");
  }
  lines.push("");

  // 日程・スポット
  lines.push("## タイムライン・目的地");
  lines.push("");
  for (const d of t.days) {
    lines.push(`### ${d.label}${d.date ? ` (${d.date})` : ""}`);
    if (d.day_index > 0 && (d.departure_point || d.departure_time)) {
      lines.push(`- 出発: ${d.departure_point ?? "未設定"} / ${d.departure_time ?? "時刻未設定"}`);
    }
    if (d.spots.length === 0) {
      lines.push("- _スポットなし_");
    } else {
      lines.push("");
      lines.push("| # | 状態 | メイン | 名称 | 区分 | 到着〜出発 | 滞在 | 予約 | 移動 |");
      lines.push("| --- | --- | --- | --- | --- | --- | --- | --- | --- |");
      d.spots.forEach((s, idx) => {
        const timeRange =
          s.arrival_planned && s.departure_planned
            ? `${s.arrival_planned.slice(11, 16)}〜${s.departure_planned.slice(11, 16)}`
            : "-";
        const tr = s.transport_from_prev
          ? `${MODE_JA[s.transport_from_prev.mode] ?? s.transport_from_prev.mode} ${
              s.transport_from_prev.duration_minutes ?? "?"
            }分`
          : "-";
        lines.push(
          `| ${idx + 1} | ${STATUS_JA[s.status] ?? s.status} | ${s.is_main ? "★" : "-"} | ${
            s.name
          } | ${CAT_JA[s.category] ?? s.category} | ${timeRange} | ${s.stay_minutes}分 | ${
            s.is_fixed && s.reservation_time ? `${s.reservation_time.slice(11, 16)} (固定)` : "-"
          } | ${tr} |`,
        );
      });
    }
    lines.push("");
  }

  // 費用
  lines.push(`## 費用・精算（${t.costs.length}件）`);
  lines.push("");
  if (t.costs.length === 0) {
    lines.push("_未登録_");
  } else {
    lines.push("| 名目 | 区分 | 支払総額 (JPY) | 支払者（本名） | 個人別内訳 | 割勘対象額 |");
    lines.push("| --- | --- | --- | --- | --- | --- |");
    for (const c of t.costs) {
      const bdSum = c.individual_breakdown.reduce((acc, b) => acc + b.amount_jpy, 0);
      const shared = c.total_paid_amount_jpy - bdSum;
      const bdText =
        c.individual_breakdown.length > 0
          ? c.individual_breakdown
              .map(
                (b) =>
                  `${b.consumer_full_name}: ${b.amount_jpy.toLocaleString("ja-JP")}円${
                    b.note ? `(${b.note})` : ""
                  }`,
              )
              .join(" / ")
          : "なし（全額割勘）";
      lines.push(
        `| ${c.title} | ${CAT_JA[c.category] ?? c.category} | ${c.total_paid_amount_jpy.toLocaleString(
          "ja-JP",
        )}円 | ${c.payer_full_name ?? "未設定"} | ${bdText} | ${shared.toLocaleString("ja-JP")}円 |`,
      );
    }
  }
  lines.push("");

  // 持ち物
  lines.push(`## 持ち物（${t.belongings.length}件）`);
  lines.push("");
  if (t.belongings.length === 0) {
    lines.push("_未登録_");
  } else {
    lines.push("| 名称 | 必要 | 準備済 | 担当者（本名） | メモ |");
    lines.push("| --- | --- | --- | --- | --- |");
    for (const b of t.belongings) {
      lines.push(
        `| ${b.name} | ${b.is_needed ? "要" : "不要"} | ${b.is_prepared ? "✅" : "未"} | ${
          b.assignee_full_name ?? "-"
        } | ${b.note || "-"} |`,
      );
    }
  }
  lines.push("");

  // 料理
  lines.push(`## 料理・材料（${t.dishes.length}件）`);
  lines.push("");
  if (t.dishes.length === 0) {
    lines.push("_未登録_");
  } else {
    for (const d of t.dishes) {
      lines.push(
        `### ${d.name}（${STATUS_JA[d.status] ?? d.status}${
          d.related_day_index !== null ? ` / Day ${d.related_day_index}` : ""
        }）`,
      );
      if (d.ingredients.length === 0) {
        lines.push("- _材料未登録_");
      } else {
        for (const ing of d.ingredients) {
          lines.push(
            `- ${ing.name}: ${ing.quantity ?? "?"}${ing.unit}（食材名: ${ing.ingredient_name}）`,
          );
        }
      }
      lines.push("");
    }
  }

  if (t.notes.trim()) {
    lines.push("## 全体メモ");
    lines.push("");
    lines.push(t.notes);
    lines.push("");
  }

  return lines.join("\n");
}
