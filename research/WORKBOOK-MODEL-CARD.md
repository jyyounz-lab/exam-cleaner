# 彩色課本／淡鉛筆補強模型

目前版本：v2，2026-11-03 訓練，整合於 0.6.1。狀態：需使用者選擇的實驗模式。v1 於 2026-11-02 訓練並整合於 0.6.0，舊參數檔保留供舊客戶端及比較使用。

## 2026-11-06 重訓評估：正式模型維持 v2

實際比較 16 組容量調整、筆色拆分及文字排列候選，來源頁分割維持 7／1／2。加入六個鄰近文字特徵的 120 棵樹候選，在彙整的稀疏標註指標略有改善；但使用者先前回報頁的原尺寸手寫選取由 2,179 降至 2,072，保留區誤選由 0 增至 3，因此未發布。正式權重與 revision 保持 v2。

本輪沒有新增獨立照片、乾淨原稿或人工完整真值。沒有訓練生成式修補模型；候選參數與原始照片留在忽略的本機資料夾。完整決策與限制見 `docs/2026-11-06-retraining-review.json`。

## v2：尺寸變化與已確認的原印示範

- 相同的 10 頁來源，各建立 900／1108／1500 像素寬的版本；仍按來源頁分割為 7 頁訓練、1 頁驗證、2 頁開發評估。不同尺寸不算新增獨立照片，亦不跨資料分割。
- 使用者已確認某頁的粗灰色橢圓、示範連線及灰色示範字原本印在教材上。依原圖建立並目視檢查保留遮罩，共 22,300 個原尺寸墨色像素；取樣含同一連通元件上的印刷圖案。這些確定的保留證據權重為一般弱標註的 12 倍，優先減少誤擦。
- 訓練使用 21 個尺寸版本、7,096 個有標籤元件，其中 320 個為手寫；數量包含同源影像變體。120 棵深度最多 3 的梯度提升樹，其餘超參數沿用 v1。
- 現行模型為 `public/models/workbook-ink-v2.json`，約 76 KiB；SHA-256 與訓練特徵摘要見 `workbook-metadata.json`。原 PHTI ONNX 不變。
- 另保護縮圖後分離的寬厚彩色插圖片段，要求其色彩強於鄰近背景，避免連帶保留有色紙面上的鉛筆。這是保守版面規則，不是辨識所有教材範例的語意模型。
- 模型使用獨立版本網址，避免舊版快取混入；恢復 v0.6.0 課本進度時重新分析，保留原圖、門檻、操作歷史及人工修正。
- 稀疏標註及部分配對參考仍有侷限。新版沒有完整標註整頁圈線，也沒有加入新的獨立盲測資料；有些區域清除較多，有些較保守。驗證見 `docs/v0.6.1-validation.json`，不宣稱全面提升或整頁清除率。

## 實際訓練了什麼

這次確實以使用者提供的配對圖片訓練一個新分類器，產生新的學習參數。它不是重新訓練 PHTI FCNN，也不是影像生成／補字模型。原有 FCNN 的檔案和 SHA-256 保持不變，提供手寫／印刷機率作為新分類器的部分輸入。

- 模型：v1 為 80 棵、v2 為 120 棵深度最多 3 的梯度提升決策樹，learning rate 0.08，min samples leaf 5，固定 seed 20261102。
- 輸入：連通筆畫的 27 個特徵，包括局部對比、色彩、大小、粗細、周圍墨色與原 FCNN 機率。
- 輸出：手寫候選分數；介面的 90% 是選取門檻，不是辨識正確率。
- v1 參數檔：`public/models/workbook-ink.json`，約 50 KB；目前 v2 的檔案資訊與雜湊見 `workbook-metadata.json`。
- Python 訓練、JSON 匯出及 JavaScript 推論使用相同特徵定義；匯出預測已與 scikit-learn 比對。
- 所有圖片準備、標註、訓練與推論皆在本機完成，沒有啟用雲端訓練或付費 API。

## 資料品質與分割

使用者提供 20 張照片，即同一本英文課本的 10 組「作答照片＋其他工具清理結果」。第二張並非乾淨原稿：有殘影、被刪除的示範字、缺損框線，且拍攝幾何與光線不同。

先以特徵匹配、透視轉換及平滑的局部對齊建立比較座標，再根據目視檢查的手寫／保留區域製作**稀疏弱標註**。對齊不確定、仍有殘影與重疊處忽略；已印好的示範字明確列為保留，即使比較圖片將它刪掉。這不是逐像素人工完整標註，也不是將另一個工具的輸出直接當作正確答案。

初版 v1 按整頁分割，避免同頁切片同時進入訓練與評估（v2 沿用來源頁分割，加入尺寸變體）：

| 用途 | 頁數 | 有標籤的筆畫元件 |
|---|---:|---:|
| 模型訓練 | 7 | 2,379，其中 107 個手寫元件 |
| 開發驗證 | 1 | 375 |
| 原先保留的評估頁 | 2 | 721 |

模型參數只使用 7 頁擬合。評估中發現網狀插圖和勾選框誤擦後，補上通用的密集線條、印刷行及矩形框線保護。因此，**最後的整體流程結果已參考評估頁調整，不是完全盲測**。同一本課本、相近字跡、少量樣本也無法證明跨教材、跨孩子或中文考卷的泛化能力。

原圖、對齊圖片、標註、特徵、結果及可識別的來源路徑全部放在被忽略的 `test-results/workbook-training/`，不納入 Git 或網站。公開內容只有程式、學習參數、合成測試及不含影像的報告。

## 清除與修補

「彩色課本／淡鉛筆」模式使用新分類器的候選，原混合／粗黑模式繼續使用原有策略。使用者可以在同一張圖即時比較，也可復原。

- 額外處理低對比筆畫，避開單純二值化漏掉的鉛筆。
- 優先保留細小不確定元件、密集線條插圖、印刷行、勾選框和導線。
- 使用既有的局部紋理填補清除候選；已確認的導線交叉處，必須從左右兩側取得足夠的真實線色，才進行修補。
- 清除和導線修補只作用於最終遮罩內；人工保留、還原與限定範圍優先。
- 已誤擦的題目可由原底圖還原；原始照片中完全被遮住的字不能靠還原工具找回，可核對後取樣相同字形。

此次沒有訓練生成式修補模型。現有比較圖不足以提供可靠的完整修補目標；若要訓練這一部分，需要真正的空白原稿／高品質乾淨對照。

## 驗證口徑

完整程式測試包含模型結構檢查、門檻與保留優先順序、連到筆跡的勾選框、密集插圖、導線雙側修補、原模式回歸，以及實際瀏覽器推論、保存恢復、離線和匯出。

十張本機照片皆經 Chromium 的實際 ONNX、補強分類器及 OpenCV 修補；v2 另測試已確認示範頁的兩種縮放版本。稀疏標註只用來比較相同區域的新舊分類器，不能稱作整頁清除率。參數比較共用本版保護規則，並非完整舊版應用程式的逐像素重現。更暗／更淡的筆跡、反光、插圖上的圈線、同字形示範字及導線交界仍可能殘留或誤選。

沒有證明整體分析更快。新分類器增加少量計算；推論速度依裝置而異，手機實機仍待驗證。

## 本機重現

需要 Python 3.12、Node.js 24 及合法取得的私人資料。將訓練環境與資料放在 `test-results/` 下：

```powershell
python -m venv test-results/training-env
test-results/training-env/Scripts/python -m pip install -r research/training-requirements.txt
test-results/training-env/Scripts/python research/prepare_pairs.py test-results/workbook-training/manifest.json
node --experimental-strip-types research/extract_ink_features.mjs test-results/workbook-training
test-results/training-env/Scripts/python research/train_ink.py test-results/workbook-training
node --experimental-strip-types research/evaluate_workbook.mjs test-results/workbook-training
# 啟動 npm run dev -- --port 4173 後：
node research/render_workbook.mjs test-results/workbook-training
```

`manifest.json` 包含 `pairs` 陣列，每組有 `id`、`source`、`comparison`、`split`；`annotations.json` 以同一 id 指定原圖座標的 `hand`、`keep`、`solidKeep` 矩形，格式為 `[x0,y0,x1,y1]`。這些私人檔案不公開提供。每次更換資料或標註都需要重新檢視對齊與標籤品質。

訓練腳本輸出到私人資料夾，**不會自動覆蓋正式模型**。先驗證候選模型，再明確更新 `public/models/workbook-ink.json` 及 metadata 的雜湊，通過發布檢查才部署。

v2 使用獨立資料目錄，保留 v1 的標註與訓練記錄。`overrides/<page-id>.png` 與原圖同尺寸，0 表示經確認的原印內容，1 表示手寫，255 表示未追加確認；資料與遮罩均為私人檔案。

```powershell
test-results/training-env/Scripts/python research/augment_workbook.py test-results/workbook-training test-results/workbook-v2/data --overrides test-results/workbook-v2/overrides
node --experimental-strip-types research/extract_augmented_features.mjs test-results/workbook-v2/data
test-results/training-env/Scripts/python research/train_ink.py test-results/workbook-v2/data
node research/render_workbook_revision.mjs test-results/workbook-v2/data
```

目前訓練腳本使用 v2 的 120 棵樹與已確認保留樣本權重；若要逐位元重現 v1，應使用 0.6.0 的腳本版本。發布 v2 時在已檢查的 JSON 設定 `revision: 2`，寫入 `workbook-ink-v2.json`，並更新 metadata 雜湊；瀏覽器渲染測試會驗證正式檔案的 revision。
