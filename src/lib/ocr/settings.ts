export type ReceiptOcrMode = "tesseract" | "developer" | "custom_azure";

export interface ReceiptOcrSettings {
  mode: ReceiptOcrMode;
  developerPasscode: string;
  customAzureEndpoint: string;
  customAzureKey: string;
}

const STORAGE_KEY = "voyage:ocr_settings";

export const DEFAULT_OCR_SETTINGS: ReceiptOcrSettings = {
  mode: "tesseract",
  developerPasscode: "",
  customAzureEndpoint: "",
  customAzureKey: "",
};

export function loadOcrSettings(): ReceiptOcrSettings {
  if (typeof window === "undefined") return DEFAULT_OCR_SETTINGS;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_OCR_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<ReceiptOcrSettings>;
    const mode: ReceiptOcrMode =
      parsed.mode === "developer" || parsed.mode === "custom_azure" || parsed.mode === "tesseract"
        ? parsed.mode
        : "tesseract";
    return {
      mode,
      developerPasscode: typeof parsed.developerPasscode === "string" ? parsed.developerPasscode : "",
      customAzureEndpoint: typeof parsed.customAzureEndpoint === "string" ? parsed.customAzureEndpoint : "",
      customAzureKey: typeof parsed.customAzureKey === "string" ? parsed.customAzureKey : "",
    };
  } catch {
    return DEFAULT_OCR_SETTINGS;
  }
}

export function saveOcrSettings(settings: ReceiptOcrSettings): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // ignore storage errors
  }
}

export function getOcrModeLabel(mode: ReceiptOcrMode): string {
  switch (mode) {
    case "tesseract":
      return "ブラウザ内OCR（Tesseract・標準）";
    case "developer":
      return "開発者モード";
    case "custom_azure":
      return "自前Azureモード（個人のAzure枠）";
  }
}
