/**
 * ブラウザ内完結のレシートOCR（Tesseract.js + 日本語レシート行パーサー）
 * - サーバーや外部クラウド課金枠（Azure等）を一切消費せず、端末のブラウザ内で文字認識を実行する。
 * - 初回実行時のみ CDN から Tesseract.js (v5) と日本語学習データを読み込む。
 */

export interface BrowserReceiptItem {
  name: string;
  quantity: number | null;
  amount_jpy: number | null;
}

export interface BrowserReceiptAnalysis {
  merchant: string | null;
  items: BrowserReceiptItem[];
  total_jpy: number | null;
  subtotal_jpy: number | null;
  tax_jpy: number | null;
  raw_text?: string;
}

interface TesseractRecognizeResult {
  data: {
    text: string;
  };
}

interface TesseractGlobal {
  recognize: (
    image: string | HTMLCanvasElement,
    langs: string,
    options?: {
      logger?: (m: { status?: string; progress?: number }) => void;
    },
  ) => Promise<TesseractRecognizeResult>;
}

declare global {
  interface Window {
    Tesseract?: TesseractGlobal;
  }
}

const CDN_URLS = [
  "https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js",
  "https://unpkg.com/tesseract.js@5/dist/tesseract.min.js",
];

let loadPromise: Promise<TesseractGlobal> | null = null;

function loadTesseractScript(): Promise<TesseractGlobal> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("ブラウザ環境でのみ実行できます"));
  }
  if (window.Tesseract) {
    return Promise.resolve(window.Tesseract);
  }
  if (loadPromise) return loadPromise;

  loadPromise = new Promise<TesseractGlobal>((resolve, reject) => {
    let idx = 0;
    const tryNext = () => {
      if (idx >= CDN_URLS.length) {
        loadPromise = null;
        reject(new Error("ブラウザ内OCRエンジンの読み込みに失敗しました。通信環境を確認してください。"));
        return;
      }
      const script = document.createElement("script");
      script.src = CDN_URLS[idx++];
      script.async = true;
      script.onload = () => {
        if (window.Tesseract) {
          resolve(window.Tesseract);
        } else {
          tryNext();
        }
      };
      script.onerror = () => {
        script.remove();
        tryNext();
      };
      document.head.appendChild(script);
    };
    tryNext();
  });

  return loadPromise;
}

/**
 * レシート画像をグレースケール＋コントラスト強調してOCR認識率を高める
 */
async function preprocessImageForOcr(imageUrl: string): Promise<string> {
  if (typeof window === "undefined") return imageUrl;
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        const w = img.naturalWidth || img.width;
        const h = img.naturalHeight || img.height;
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          resolve(imageUrl);
          return;
        }
        ctx.drawImage(img, 0, 0, w, h);
        const imageData = ctx.getImageData(0, 0, w, h);
        const d = imageData.data;
        // グレースケール化 & 軽いコントラストストレッチ
        for (let i = 0; i < d.length; i += 4) {
          const gray = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
          const contrasted = Math.max(0, Math.min(255, (gray - 128) * 1.35 + 128));
          d[i] = contrasted;
          d[i + 1] = contrasted;
          d[i + 2] = contrasted;
        }
        ctx.putImageData(imageData, 0, 0);
        resolve(canvas.toDataURL("image/jpeg", 0.92));
      } catch {
        resolve(imageUrl);
      }
    };
    img.onerror = () => resolve(imageUrl);
    img.src = imageUrl;
  });
}

/**
 * ブラウザ内Tesseract.jsでレシート画像を解析する
 */
export async function analyzeReceiptInBrowser(
  imageUrl: string,
  onProgress?: (statusText: string) => void,
): Promise<BrowserReceiptAnalysis> {
  onProgress?.("ブラウザ内OCRエンジンを準備中...");
  const tesseract = await loadTesseractScript();
  const processed = await preprocessImageForOcr(imageUrl);

  onProgress?.("端末内でレシートの文字を読み取り中...");
  const res = await tesseract.recognize(processed, "jpn+eng", {
    logger: (m) => {
      if (m.status === "recognizing text" && typeof m.progress === "number") {
        const pct = Math.round(m.progress * 100);
        onProgress?.(`端末内で文字を解析中... (${pct}%)`);
      }
    },
  });

  const rawText = res?.data?.text ?? "";
  return parseReceiptTextToAnalysis(rawText);
}

/**
 * OCRで抽出した生テキストから店名・品目・金額・合計をヒューリスティック抽出する
 */
export function parseReceiptTextToAnalysis(rawText: string): BrowserReceiptAnalysis {
  const normalized = rawText
    .normalize("NFKC")
    .replace(/[￥\\]/g, "¥")
    .replace(/[，]/g, ",")
    .replace(/[▲△ー−–—]/g, "-");

  const lines = normalized
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter((l) => l.length > 0);

  let merchant: string | null = null;
  let totalJpy: number | null = null;
  let subtotalJpy: number | null = null;
  let taxJpy: number | null = null;
  const items: BrowserReceiptItem[] = [];

  // 除外すべきノイズ行（日付・電話番号・インボイス番号・レジ情報・お釣りなど）
  const IGNORE_LINE_RE =
    /(?:^\d{2,4}[\/\-年]\d{1,2}[\/\-月]\d{1,2}|TEL|電話|FAX|〒\d{3}|登録番号|T\d{12,13}|領収[書証]|レシート|お買[い]?上[げ]?明細|毎度ありがとう|またのお越し|クレジット|VISA|MASTER|JCB|PayPay|Suica|ICOCA|PASMO|QUICPay|iD|お預[かり]*|お釣[り]*|おつり|釣銭|ポイント|残高|会員|承認番号|取引通番|テーブル|担当|レジ|責No)/i;

  const TOTAL_LINE_RE = /(?:合\s*計|お買上計|お支払[い]?計?|総\s*計|総\s*額|領収金額|TOTAL)/i;
  const SUBTOTAL_LINE_RE = /(?:小\s*計|税抜計|SUB\s*TOTAL)/i;
  const TAX_LINE_RE = /(?:消費税|内消費税|外税|内税|税\s*額|(?:8|10)%\s*(?:対象|税))/i;
  const NON_ITEM_SUMMARY_RE = /(?:点数|買上点数|対象額|対象計|非課税|課税対象)/i;

  // 行末または行中の金額らしき数値を抽出するヘルパー
  function extractLastAmount(line: string): { amount: number; prefixText: string } | null {
    // 例: "チーズバーグディッシュ ¥1,290", "コーラ 300円", "ポテト *450", "割引 -100"
    const m = line.match(
      /^(.*?)\s*(?:[¥*※@]|税込|税抜)?\s*(-?\d{1,3}(?:,\d{3})+|-?\d{2,6})\s*(?:円|[外内軽※*E])?\s*$/,
    );
    if (!m) return null;
    const rawNum = m[2].replace(/,/g, "");
    const val = Number(rawNum);
    if (!Number.isFinite(val) || val === 0 || Math.abs(val) > 500_000) return null;
    return { amount: Math.round(val), prefixText: m[1].trim() };
  }

  function extractAnyAmount(line: string): number | null {
    const matches = Array.from(line.matchAll(/(?:¥\s*)?(-?\d{1,3}(?:,\d{3})+|-?\d{2,6})\s*円?/g));
    if (matches.length === 0) return null;
    const last = matches[matches.length - 1][1].replace(/,/g, "");
    const val = Number(last);
    if (!Number.isFinite(val) || val <= 0 || val > 500_000) return null;
    return Math.round(val);
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // 1. 合計行の判定
    if (TOTAL_LINE_RE.test(line) && !SUBTOTAL_LINE_RE.test(line)) {
      const amt = extractAnyAmount(line) ?? (i + 1 < lines.length ? extractAnyAmount(lines[i + 1]) : null);
      if (amt !== null && amt > 0) {
        // より大きい合計金額または最初の合計を採用
        if (totalJpy === null || amt >= totalJpy) {
          totalJpy = amt;
        }
      }
      continue;
    }

    // 2. 小計行の判定
    if (SUBTOTAL_LINE_RE.test(line)) {
      const amt = extractAnyAmount(line);
      if (amt !== null && amt > 0) subtotalJpy = amt;
      continue;
    }

    // 3. 税金行の判定
    if (TAX_LINE_RE.test(line)) {
      const amt = extractAnyAmount(line);
      if (amt !== null && amt > 0) taxJpy = amt;
      continue;
    }

    if (IGNORE_LINE_RE.test(line) || NON_ITEM_SUMMARY_RE.test(line)) {
      continue;
    }

    // 4. 先頭付近の行から店名候補を拾う
    if (merchant === null && i <= 4) {
      const cleaned = line.replace(/[¥\d,.\-*※#@!！?？]/g, "").trim();
      if (cleaned.length >= 2 && cleaned.length <= 30 && !extractLastAmount(line)) {
        merchant = line.slice(0, 60);
      }
    }

    // 5. 品目行の判定
    const parsed = extractLastAmount(line);
    if (parsed) {
      let name = parsed.prefixText
        .replace(/^[\d\-\s.*※#]+/, "")
        .replace(/\s+[@＠]\d+.*$/, "")
        .trim();

      // 直前の行が金額なしの品目名だった場合（2行に分かれているレシート）の補完
      if (!name && i > 0) {
        const prev = lines[i - 1];
        if (
          !TOTAL_LINE_RE.test(prev) &&
          !SUBTOTAL_LINE_RE.test(prev) &&
          !TAX_LINE_RE.test(prev) &&
          !IGNORE_LINE_RE.test(prev) &&
          !extractLastAmount(prev)
        ) {
          name = prev.replace(/^[\d\-\s.*※#]+/, "").trim();
        }
      }

      // 値引き・クーポンの場合
      const isDiscount = /(?:値引|割引|クーポン|引)/i.test(name);
      const amount = isDiscount && parsed.amount > 0 ? -parsed.amount : parsed.amount;

      if (name && name.length >= 1 && Math.abs(amount) >= 10) {
        items.push({
          name: name.slice(0, 120),
          quantity: 1,
          amount_jpy: amount,
        });
      }
    }
  }

  // 合計金額が見つからなかった場合は、品目合計または小計から補完する
  if (totalJpy === null) {
    if (items.length > 0) {
      const sum = items.reduce((acc, it) => acc + (it.amount_jpy ?? 0), 0);
      if (sum > 0) totalJpy = sum;
    } else if (subtotalJpy !== null && subtotalJpy > 0) {
      totalJpy = subtotalJpy + (taxJpy ?? 0);
    }
  }

  return {
    merchant,
    items,
    total_jpy: totalJpy,
    subtotal_jpy: subtotalJpy,
    tax_jpy: taxJpy,
    raw_text: rawText,
  };
}
