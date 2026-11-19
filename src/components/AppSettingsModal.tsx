"use client";

import { useState } from "react";
import {
  X,
  Settings,
  ScanText,
  KeyRound,
  CloudCog,
  Check,
  Sparkles,
  Info,
  ShieldAlert,
  ExternalLink,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import {
  getOcrModeLabel,
  loadOcrSettings,
  saveOcrSettings,
  type ReceiptOcrMode,
  type ReceiptOcrSettings,
} from "@/lib/ocr/settings";

interface AppSettingsModalProps {
  onClose: () => void;
  onOpenMuseExport: () => void;
  onSettingsChanged?: (next: ReceiptOcrSettings) => void;
}

export default function AppSettingsModal({
  onClose,
  onOpenMuseExport,
  onSettingsChanged,
}: AppSettingsModalProps) {
  const [settings, setSettings] = useState<ReceiptOcrSettings>(() => loadOcrSettings());
  // 初期状態では現在の方式を表示し、「変更」を押すと選択肢（開発者モード / 自前Azureモード / ブラウザ内OCR）が展開される
  const [isChangingOcr, setIsChangingOcr] = useState<boolean>(() => settings.mode !== "tesseract");
  const [savedBanner, setSavedBanner] = useState(false);
  const [showAzureGuide, setShowAzureGuide] = useState(true);

  function updateSettings(patch: Partial<ReceiptOcrSettings>) {
    const next = { ...settings, ...patch };
    setSettings(next);
    saveOcrSettings(next);
    onSettingsChanged?.(next);
    setSavedBanner(true);
    setTimeout(() => setSavedBanner(false), 1800);
  }

  function handleSelectMode(mode: ReceiptOcrMode) {
    updateSettings({ mode });
  }

  return (
    <div
      className="fixed inset-0 z-[2500] bg-slate-900/50 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4"
      onClick={onClose}
    >
      <div
        className="liquid-glass-strong w-full sm:max-w-lg max-h-[92dvh] rounded-t-3xl sm:rounded-3xl shadow-2xl flex flex-col overflow-hidden text-slate-900"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ヘッダー */}
        <div className="px-5 py-3.5 border-b border-white/70 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-[var(--theme-accent)] text-white flex items-center justify-center shadow-xs">
              <Settings className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-extrabold text-slate-900">設定・アプリ情報</h2>
              <p className="text-[11px] text-slate-500">レシート読み取り方式・データ出力・免責事項</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-xl text-slate-500 hover:bg-white/80"
            aria-label="閉じる"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* 本体 */}
        <div className="flex-1 overflow-y-auto overflow-x-hidden overscroll-x-none touch-pan-y p-4 sm:p-5 space-y-5">
          {/* 1. レシート読み取り方法の設定 */}
          <section className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-xs font-extrabold text-slate-800 flex items-center gap-1.5">
                <ScanText className="w-4 h-4 text-[var(--theme-accent-text)]" />
                <span>レシート読み取り方法</span>
              </h3>
              {savedBanner && (
                <span className="inline-flex items-center gap-1 text-[11px] font-bold text-[var(--theme-accent-text)] bg-[var(--theme-accent-soft)] border border-[var(--theme-accent-border)] px-2 py-0.5 rounded-full">
                  <Check className="w-3 h-3" />
                  保存しました
                </span>
              )}
            </div>

            {/* 現在の選択状態カード ＋「変更」ボタン */}
            <div className="rounded-2xl bg-white/85 border border-slate-200 p-3.5 space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-[10px] font-bold text-slate-400">現在の読み取り方式</div>
                  <div className="text-xs font-extrabold text-slate-900 mt-0.5">
                    {getOcrModeLabel(settings.mode)}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setIsChangingOcr((v) => !v)}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl border border-[var(--theme-accent-border)] bg-[var(--theme-accent-soft)] text-[var(--theme-accent-text)] text-xs font-extrabold hover:opacity-90 shrink-0"
                >
                  <span>{isChangingOcr ? "閉じる" : "変更"}</span>
                  {isChangingOcr ? (
                    <ChevronUp className="w-3.5 h-3.5" />
                  ) : (
                    <ChevronDown className="w-3.5 h-3.5" />
                  )}
                </button>
              </div>

              {settings.mode !== "developer" && (
                <p className="text-[11px] text-slate-600 leading-relaxed">
                  {settings.mode === "tesseract" &&
                    "初期設定：お使いの端末（ブラウザ内）で文字認識を行うため、回数制限なしで誰でも無料で使えます（認識精度は簡易的です）。"}
                  {settings.mode === "custom_azure" &&
                    "ご自身で取得したAzure Document Intelligence（月500枚無料枠など）のキーで高精度に読み取ります。"}
                </p>
              )}

              {/* 「変更」を押したときに展開される選択肢 */}
              {isChangingOcr && (
                <div className="pt-2.5 border-t border-slate-200/80 space-y-2.5">
                  <div className="text-[11px] font-bold text-slate-700">
                    読み取り方式を選択してください
                  </div>

                  {/* 選択肢1: ブラウザ内OCR (Tesseract) - 初期状態 */}
                  <label
                    className={`flex items-start gap-2.5 rounded-2xl p-3 border cursor-pointer transition ${
                      settings.mode === "tesseract"
                        ? "bg-[var(--theme-accent-soft)] border-[var(--theme-accent)]"
                        : "bg-white border-slate-200 hover:bg-slate-50"
                    }`}
                  >
                    <input
                      type="radio"
                      name="ocrMode"
                      checked={settings.mode === "tesseract"}
                      onChange={() => handleSelectMode("tesseract")}
                      className="mt-0.5 accent-[var(--theme-accent)]"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-extrabold text-slate-900 flex items-center gap-1.5 flex-wrap">
                        <span>ブラウザ内OCR（Tesseract）</span>
                        <span className="px-1.5 py-0.2 rounded-full text-[10px] font-bold bg-slate-200/80 text-slate-700">
                          初期設定・無制限
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-600 mt-0.5 leading-relaxed">
                        端末のブラウザ内でOCR処理を行います。設定不要で何回でも使えますが、AI読み取りに比べて品目や金額の認識精度は簡易的です。
                      </p>
                    </div>
                  </label>

                  {/* 選択肢2: 自前Azureモード */}
                  <div
                    className={`rounded-2xl p-3 border transition space-y-2.5 ${
                      settings.mode === "custom_azure"
                        ? "bg-[var(--theme-accent-soft)] border-[var(--theme-accent)]"
                        : "bg-white border-slate-200"
                    }`}
                  >
                    <label className="flex items-start gap-2.5 cursor-pointer">
                      <input
                        type="radio"
                        name="ocrMode"
                        checked={settings.mode === "custom_azure"}
                        onChange={() => handleSelectMode("custom_azure")}
                        className="mt-0.5 accent-[var(--theme-accent)]"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="text-xs font-extrabold text-slate-900 flex items-center gap-1.5">
                          <CloudCog className="w-3.5 h-3.5 text-[var(--theme-accent-text)]" />
                          <span>自前Azureモード（自分のAzure枠を使う）</span>
                        </div>
                        <p className="text-[11px] text-slate-600 mt-0.5 leading-relaxed">
                          ご自身でMicrosoft Azureの無料枠（月500枚まで無料）を作成し、高精度なAIレシート読み取りを利用できます。
                        </p>
                      </div>
                    </label>

                    {settings.mode === "custom_azure" && (
                      <div className="pl-6 space-y-2.5">
                        <div className="space-y-1.5">
                          <label className="block text-[11px] font-bold text-slate-700">
                            エンドポイント（Endpoint URL）
                          </label>
                          <input
                            type="url"
                            value={settings.customAzureEndpoint}
                            onChange={(e) => updateSettings({ customAzureEndpoint: e.target.value })}
                            placeholder="https://xxxx.cognitiveservices.azure.com/"
                            className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-white text-xs font-mono focus:outline-none focus:ring-2 focus:ring-[var(--theme-accent)]"
                          />
                        </div>

                        <div className="space-y-1.5">
                          <label className="block text-[11px] font-bold text-slate-700">
                            APIキー（KEY 1 または KEY 2）
                          </label>
                          <input
                            type="password"
                            value={settings.customAzureKey}
                            onChange={(e) => updateSettings({ customAzureKey: e.target.value })}
                            placeholder="Azure Document Intelligence のキーを貼り付け"
                            className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-white text-xs font-mono focus:outline-none focus:ring-2 focus:ring-[var(--theme-accent)]"
                          />
                        </div>

                        {/* 設定方法の解説文 */}
                        <div className="rounded-xl bg-white/90 border border-slate-200 p-3 space-y-2">
                          <button
                            type="button"
                            onClick={() => setShowAzureGuide((v) => !v)}
                            className="w-full flex items-center justify-between text-left text-[11px] font-extrabold text-[var(--theme-accent-text)]"
                          >
                            <span className="flex items-center gap-1">
                              <Info className="w-3.5 h-3.5 shrink-0" />
                              Azure無料枠（月500枚）の作成・設定方法
                            </span>
                            <span>{showAzureGuide ? "隠す" : "手順を見る"}</span>
                          </button>

                          {showAzureGuide && (
                            <ol className="list-decimal list-inside space-y-1.5 text-[11px] text-slate-700 leading-relaxed pt-1 border-t border-slate-100">
                              <li>
                                <a
                                  href="https://portal.azure.com/"
                                  target="_blank"
                                  rel="noreferrer"
                                  className="text-[var(--theme-accent-text)] font-bold underline inline-flex items-center gap-0.5"
                                >
                                  Azureポータル
                                  <ExternalLink className="w-2.5 h-2.5" />
                                </a>{" "}
                                にサインイン（または無料アカウント作成）します。
                              </li>
                              <li>
                                上部の検索バーで <strong>「Document Intelligence」</strong>（旧 Form Recognizer）を検索し、「作成」を押します。
                              </li>
                              <li>
                                リージョン（East US や Japan East など）を選び、価格レベル（Pricing tier）で必ず <strong>「Free (F0)」</strong> を選択して作成します（F0は月500枚まで完全無料・超過しても自動課金されません）。
                              </li>
                              <li>
                                作成完了後、リソース画面の左メニュー <strong>「リソース管理 ＞ キーとエンドポイント」</strong> を開きます。
                              </li>
                              <li>
                                表示されている <strong>「エンドポイント」</strong> と <strong>「KEY 1」</strong> をコピーし、上の2つの入力欄に貼り付ければ設定完了です（キーはお使いのブラウザ内にのみ保存されます）。
                              </li>
                            </ol>
                          )}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* 選択肢3: 開発者モード（一番下） */}
                  <div
                    className={`rounded-2xl p-3 border transition space-y-2.5 ${
                      settings.mode === "developer"
                        ? "bg-[var(--theme-accent-soft)] border-[var(--theme-accent)]"
                        : "bg-white border-slate-200"
                    }`}
                  >
                    <label className="flex items-center gap-2.5 cursor-pointer">
                      <input
                        type="radio"
                        name="ocrMode"
                        checked={settings.mode === "developer"}
                        onChange={() => handleSelectMode("developer")}
                        className="accent-[var(--theme-accent)]"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="text-xs font-extrabold text-slate-900 flex items-center gap-1.5">
                          <KeyRound className="w-3.5 h-3.5 text-[var(--theme-accent-text)]" />
                          <span>開発者モード</span>
                        </div>
                      </div>
                    </label>

                    {settings.mode === "developer" && (
                      <div className="pl-6">
                        <input
                          type="password"
                          value={settings.developerPasscode}
                          onChange={(e) => updateSettings({ developerPasscode: e.target.value })}
                          placeholder="合言葉"
                          className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-white text-xs font-mono focus:outline-none focus:ring-2 focus:ring-[var(--theme-accent)]"
                        />
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </section>

          {/* 2. データ書き出し（Muse連携） */}
          <section className="space-y-2.5 pt-3 border-t border-slate-200/80">
            <h3 className="text-xs font-extrabold text-slate-800 flex items-center gap-1.5">
              <Sparkles className="w-4 h-4 text-[var(--theme-accent-text)]" />
              <span>データ書き出し・AI連携</span>
            </h3>
            <div className="rounded-2xl bg-white/85 border border-slate-200 p-3.5 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-xs font-extrabold text-slate-900">Muse連携用データを出力</div>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  しおり全体の構造化データ（JSON・Markdown・読み取り専用サマリーURL）を出力します。
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onOpenMuseExport();
                }}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl liquid-btn-primary text-white text-xs font-extrabold shrink-0"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>データ出力</span>
              </button>
            </div>
          </section>

          {/* 3. クレジット・ご利用上の注意（免責事項） */}
          <section className="space-y-2.5 pt-3 border-t border-slate-200/80">
            <h3 className="text-xs font-extrabold text-slate-800 flex items-center gap-1.5">
              <ShieldAlert className="w-4 h-4 text-slate-600" />
              <span>クレジット・ご利用上の注意</span>
            </h3>
            <div className="rounded-2xl bg-white/80 border border-slate-200 p-3.5 space-y-2.5 text-[11px] text-slate-600 leading-relaxed">
              <div>
                <div className="font-extrabold text-slate-800 mb-0.5">免責事項・サポートについて</div>
                <p>
                  本アプリは個人開発によるプロジェクトです。動作の完全性やデータの永続性については保証いたしかねます。万が一バグや不具合、ご不便な点などがありましても個別の修正やサポート対応はいたしかねますので、必要に応じてご自身で開発・構築してご利用ください。
                </p>
              </div>
              <div className="pt-2 border-t border-slate-200/70">
                <div className="font-extrabold text-slate-800 mb-0.5">クレジット・参考</div>
                <p>
                  本アプリは、ギズモード・ジャパン（GIZMODO JAPAN）の中橋氏が制作・紹介されていた旅行しおりアプリを参考に制作しました。
                </p>
              </div>
            </div>
          </section>
        </div>

        {/* フッター */}
        <div className="px-5 py-3 border-t border-white/70 flex justify-end shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2 rounded-xl liquid-btn-primary text-white text-xs font-extrabold"
          >
            閉じる
          </button>
        </div>
      </div>
    </div>
  );
}
