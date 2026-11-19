/**
 * レシート画像のクライアント側処理。
 * - 文字の可読性を保つため長辺 2000px・高画質から始め、上限サイズを超える場合のみ段階的に縮小・圧縮する。
 * - Azure F0 の上限は 4MB。ホスティングのリクエスト上限も考慮し既定 3MB を目標にする。
 */
export const RECEIPT_TARGET_BYTES = 3 * 1024 * 1024;

export function dataUrlBytes(dataUrl: string): number {
  const b64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
  const pad = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
  return Math.floor((b64.length * 3) / 4) - pad;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("画像を読み込めませんでした"));
    img.src = src;
  });
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onerror = () => reject(new Error("画像の読み込みに失敗しました"));
    r.onload = () => resolve(String(r.result));
    r.readAsDataURL(blob);
  });
}

async function encode(src: string, maxSide: number, quality: number): Promise<string> {
  const img = await loadImage(src);
  const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("画像を変換できませんでした");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);
  return canvas.toDataURL("image/jpeg", quality);
}

/** 可読性を保ったまま targetBytes 以下の JPEG data URL にする */
export async function compressReceiptSource(src: string, targetBytes = RECEIPT_TARGET_BYTES): Promise<string> {
  const steps: [number, number][] = [
    [2000, 0.88],
    [2000, 0.78],
    [1700, 0.75],
    [1400, 0.72],
    [1200, 0.68],
  ];
  let last = "";
  for (const [side, q] of steps) {
    last = await encode(src, side, q);
    if (dataUrlBytes(last) <= targetBytes) return last;
  }
  throw new Error("画像を4MB以下に圧縮できませんでした");
}

export async function compressReceiptFile(file: File, targetBytes = RECEIPT_TARGET_BYTES): Promise<string> {
  const src = await blobToDataUrl(file);
  return compressReceiptSource(src, targetBytes);
}

/** 添付済みレシート（data URL / https URL）を読み取り送信用の data URL（上限以下）にする */
export async function receiptUrlToUploadable(url: string, targetBytes = RECEIPT_TARGET_BYTES): Promise<string> {
  let src = url;
  if (!url.startsWith("data:")) {
    const res = await fetch(url);
    if (!res.ok) throw new Error("レシート画像を取得できませんでした");
    src = await blobToDataUrl(await res.blob());
  }
  if (/^data:image\/(jpeg|png|webp);base64,/.test(src) && dataUrlBytes(src) <= targetBytes) return src;
  return compressReceiptSource(src, targetBytes);
}
