/**
 * 営業時間・定休日（business_hours）の解析と、到着・出発予定時刻との照合ユーティリティ
 *
 * 保存形式（SpotRow.transport_note または memo を汚さないよう、transport_note に JSON メタを格納可能にするか、
 * あるいは人間にも読める標準書式 `[営業: 09:00-17:00 | 定休: 水]` / OSM opening_hours 文字列を解析する）
 */

export interface BusinessHoursRule {
  /** 営業開始 HH:MM（24時間制） */
  open: string | null;
  /** 営業終了 HH:MM（24時間制） */
  close: string | null;
  /** 定休日の曜日番号配列 (0=日, 1=月, 2=火, 3=水, 4=木, 5=金, 6=土) */
  closedDays: number[];
  /** OSM等から取得した生テキスト */
  rawText: string;
  /** 宿泊用: 施設の最速チェックイン可能時刻 HH:MM（例: "14:00"） */
  policyCheckIn?: string | null;
  /** 宿泊用: 施設の最終チェックアウト期限 HH:MM（例: "11:00"） */
  policyCheckOut?: string | null;
}

const DAY_NAMES_JA = ["日", "月", "火", "水", "木", "金", "土"] as const;
const OSM_DAY_MAP: Record<string, number> = {
  Su: 0,
  Mo: 1,
  Tu: 2,
  We: 3,
  Th: 4,
  Fr: 5,
  Sa: 6,
};

export function dayNumberToJa(d: number): string {
  return DAY_NAMES_JA[d] ?? "";
}

/**
 * OSM の `opening_hours` タグ（例: `Mo-Fr 09:00-17:00; We off` や `10:00-20:00`）から
 * 簡易ルール（open / close / closedDays）を抽出する
 */
export function parseOsmOpeningHours(osm: string | null | undefined): BusinessHoursRule {
  const raw = (osm ?? "").trim();
  if (!raw || raw === "24/7") {
    return { open: null, close: null, closedDays: [], rawText: raw === "24/7" ? "24時間営業" : "" };
  }

  let open: string | null = null;
  let close: string | null = null;
  const closedSet = new Set<number>();

  // 時刻範囲 (例: 09:00-17:00)
  const timeMatch = raw.match(/([01]\d|2[0-3]):[0-5]\d\s*-\s*([012]\d):[0-5]\d/);
  if (timeMatch) {
    const parts = timeMatch[0].split("-").map((s) => s.trim());
    open = parts[0];
    close = parts[1] === "24:00" ? "23:59" : parts[1];
  }

  // "We off" / "Tu,We off" / "Su closed" などの定休日指定
  const segments = raw.split(";").map((s) => s.trim());
  for (const seg of segments) {
    if (/\b(off|closed)\b/i.test(seg)) {
      for (const [k, num] of Object.entries(OSM_DAY_MAP)) {
        if (new RegExp(`\\b${k}\\b`).test(seg)) {
          closedSet.add(num);
        }
      }
    }
  }

  // もし "Mo-Fr 10:00-18:00" のように営業曜日だけが単一セグメントで書かれている場合
  if (segments.length === 1 && !/\b(off|closed)\b/i.test(raw)) {
    const rangeMatch = raw.match(/\b(Mo|Tu|We|Th|Fr|Sa|Su)\s*-\s*(Mo|Tu|We|Th|Fr|Sa|Su)\b/);
    if (rangeMatch) {
      const start = OSM_DAY_MAP[rangeMatch[1]];
      const end = OSM_DAY_MAP[rangeMatch[2]];
      if (start !== undefined && end !== undefined && start <= end) {
        for (let d = 0; d <= 6; d++) {
          if (d < start || d > end) closedSet.add(d);
        }
      }
    }
  }

  return {
    open,
    close,
    closedDays: [...closedSet].sort(),
    rawText: raw,
  };
}

/**
 * 日本語の検索結果テキスト（例: "営業時間 11:00～20:00 定休日 毎週火曜日" や "11時～20時 休日：火曜"）から
 * 開店・閉店時刻と定休日を抽出する
 */
export function parseJapaneseBusinessHoursFromText(text: string): BusinessHoursRule {
  // 全角数字・コロンを半角に正規化
  const norm = text
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/：/g, ":")
    .replace(/&nbsp;|&middot;|&gt;|&lt;/g, " ");

  let open: string | null = null;
  let close: string | null = null;

  const pad2 = (n: string) => n.padStart(2, "0");

  // 1. 「営業時間」付近の時刻パターンを最優先で探す
  const nearLabelRegex =
    /(?:営業時間|営業|ご入浴|外来入浴)[^0-9]{0,25}?(\d{1,2})(?::(\d{2})|時(?:(\d{2})分)?)?\s*[〜～~\-－ー]\s*(\d{1,2})(?::(\d{2})|時(?:(\d{2})分)?)?/;
  const m1 = norm.match(nearLabelRegex);
  if (m1) {
    const h1 = Number(m1[1]);
    const min1 = m1[2] ?? m1[3] ?? "00";
    const h2 = Number(m1[4]);
    const min2 = m1[5] ?? m1[6] ?? "00";
    if (h1 >= 0 && h1 <= 23 && h2 >= 0 && h2 <= 24) {
      open = `${pad2(String(h1))}:${min1}`;
      close = h2 === 24 ? "23:59" : `${pad2(String(h2))}:${min2}`;
    }
  }

  // 2. 見つからなければ HH:MM〜HH:MM または H時〜H時 の一般パターン
  if (!open || !close) {
    const generalRegex =
      /(\d{1,2})(?::(\d{2})|時(?:(\d{2})分)?)\s*[〜～~\-－ー]\s*(\d{1,2})(?::(\d{2})|時(?:(\d{2})分)?)/;
    const m2 = norm.match(generalRegex);
    if (m2) {
      const h1 = Number(m2[1]);
      const min1 = m2[2] ?? m2[3] ?? "00";
      const h2 = Number(m2[4]);
      const min2 = m2[5] ?? m2[6] ?? "00";
      if (h1 >= 4 && h1 <= 22 && h2 >= 8 && h2 <= 24) {
        open = `${pad2(String(h1))}:${min1}`;
        close = h2 === 24 ? "23:59" : `${pad2(String(h2))}:${min2}`;
      }
    }
  }

  // 3. 定休日・休館日・休日の曜日抽出
  //    ただし「（火曜日が祝祭日の場合は木曜日）」のような括弧内の条件曜日は誤検出しないよう先に括弧を除去する
  const withoutParens = norm.replace(/（[^）]*）|\([^)]*\)/g, " ");
  const closedSet = new Set<number>();
  const closedRegex = /(?:定休日|休館日|休業日|休日|店休日)\s*[:.\s]*([^\n。;；]{1,25})/g;
  let cm: RegExpExecArray | null;
  while ((cm = closedRegex.exec(withoutParens)) !== null) {
    const snippet = cm[1];
    if (/無休|なし/.test(snippet)) continue;
    DAY_NAMES_JA.forEach((ja, idx) => {
      if (new RegExp(`${ja}曜|毎週${ja}|[・、,\\s]${ja}(?:[・、,\\s]|$)`).test(snippet)) {
        closedSet.add(idx);
      }
    });
  }

  const closedDays = [...closedSet].sort();
  const summaryParts: string[] = [];
  if (open && close) summaryParts.push(`${open}〜${close}`);
  if (closedDays.length > 0) {
    summaryParts.push(`定休:${closedDays.map((d) => `${dayNumberToJa(d)}曜`).join("・")}`);
  }

  return {
    open,
    close,
    closedDays,
    rawText: summaryParts.join(" / "),
  };
}

/** BusinessHoursRule を SpotRow.transport_note に保存・復元するシリアライズ関数 */
export function serializeBusinessHours(rule: BusinessHoursRule): string {
  if (
    !rule.open &&
    !rule.close &&
    rule.closedDays.length === 0 &&
    !rule.rawText &&
    !rule.policyCheckIn &&
    !rule.policyCheckOut
  ) {
    return "";
  }
  return JSON.stringify({
    bh: 1,
    open: rule.open,
    close: rule.close,
    closedDays: rule.closedDays,
    rawText: rule.rawText,
    policyCheckIn: rule.policyCheckIn ?? null,
    policyCheckOut: rule.policyCheckOut ?? null,
  });
}

export function deserializeBusinessHours(stored: string | null | undefined): BusinessHoursRule {
  if (!stored) return { open: null, close: null, closedDays: [], rawText: "" };
  try {
    const obj = JSON.parse(stored) as {
      bh?: number;
      open?: string | null;
      close?: string | null;
      closedDays?: number[];
      rawText?: string;
      policyCheckIn?: string | null;
      policyCheckOut?: string | null;
    };
    if (obj && obj.bh === 1) {
      return {
        open: obj.open ?? null,
        close: obj.close ?? null,
        closedDays: Array.isArray(obj.closedDays) ? obj.closedDays : [],
        rawText: obj.rawText ?? "",
        policyCheckIn: obj.policyCheckIn ?? null,
        policyCheckOut: obj.policyCheckOut ?? null,
      };
    }
  } catch {
    // not JSON
  }
  return { open: null, close: null, closedDays: [], rawText: "" };
}

function hhmmToMin(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

/**
 * 日付（YYYY-MM-DD）と到着・出発予定時刻（HH:MM）を営業時間・定休日ルールと照合し、
 * 警告メッセージ（問題なければ null）を返す
 */
export function checkBusinessHoursAlert(
  rule: BusinessHoursRule,
  dayDate: string | null,
  arrivalHHMM: string | null,
  departureHHMM: string | null,
): string | null {
  // 1. 定休日チェック
  if (dayDate && rule.closedDays.length > 0) {
    const [y, m, d] = dayDate.split("-").map(Number);
    const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    if (rule.closedDays.includes(dow)) {
      const closedLabel = rule.closedDays.map((x) => `${dayNumberToJa(x)}曜`).join("・");
      return `⚠️ 休業日の可能性があります（定休日: ${closedLabel}）`;
    }
  }

  // 2. 営業時間チェック
  if (rule.open && rule.close && arrivalHHMM) {
    const openMin = hhmmToMin(rule.open);
    const closeMin = hhmmToMin(rule.close);
    const arrMin = hhmmToMin(arrivalHHMM);
    const depMin = departureHHMM ? hhmmToMin(departureHHMM) : arrMin;

    if (closeMin >= openMin) {
      if (arrMin < openMin) {
        return `⚠️ 営業時間前です（営業 ${rule.open}〜${rule.close} / 到着予定 ${arrivalHHMM}）`;
      }
      if (arrMin >= closeMin || depMin > closeMin) {
        return `⚠️ 営業時間外です（営業 ${rule.open}〜${rule.close} / 予定 ${arrivalHHMM}〜${departureHHMM ?? ""}）`;
      }
    }
  }

  return null;
}

/**
 * 宿泊施設の規定チェックイン開始（policyCheckIn）・最終チェックアウト期限（policyCheckOut）と、
 * 実際の予定チェックイン（plannedCheckInHHMM）・予定チェックアウト（plannedCheckOutHHMM）を照合して警告を返す
 */
export function checkLodgingPolicyAlert(
  rule: BusinessHoursRule,
  plannedCheckInHHMM: string | null,
  plannedCheckOutHHMM: string | null,
): string | null {
  if (rule.policyCheckIn && plannedCheckInHHMM) {
    const pMin = hhmmToMin(rule.policyCheckIn);
    const aMin = hhmmToMin(plannedCheckInHHMM);
    if (aMin < pMin) {
      return `⚠️ 予定チェックイン（${plannedCheckInHHMM}）が施設のチェックイン開始時刻（${rule.policyCheckIn}〜）より${pMin - aMin}分早いです`;
    }
  }
  if (rule.policyCheckOut && plannedCheckOutHHMM) {
    const pMin = hhmmToMin(rule.policyCheckOut);
    const aMin = hhmmToMin(plannedCheckOutHHMM);
    if (aMin > pMin) {
      return `⚠️ 予定チェックアウト（${plannedCheckOutHHMM}）が最終チェックアウト期限（〜${rule.policyCheckOut}）を${aMin - pMin}分超過しています`;
    }
  }
  return null;
}
