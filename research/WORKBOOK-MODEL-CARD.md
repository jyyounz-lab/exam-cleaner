# 彩色課本／淡鉛筆補強模型 v1

訓練日期：2026-11-02。整合版本：0.6.0。狀態：需使用者選擇的實驗模式。

## 實際訓練了什麼

這次確實以使用者提供的配對圖片訓練一個新分類器，產生新的學習參數。它不是重新訓練 PHTI FCNN，也不是影像生成／補字模型。原有 FCNN 的檔案和 SHA-256 保持不變，提供手寫／印刷機率作為新分類器的部分輸入。

- 模型：80 棵深度最多 3 的梯度提升決策樹，learning rate 0.08，min samples leaf 5，固定 seed 20261102。
- 輸入：連通筆畫的 27 個特徵，包括局部對比、色彩、大小、粗細、周圍墨色與原 FCNN 機率。
- 輸出：手寫候選分數；介面的 90% 是選取門檻，不是辨識正確率。
- 參數檔：`public/models/workbook-ink.json`，約 50 KB。檔案資訊與雜湊見 `workbook-metadata.json`。
- Python 訓練、JSON 匯出及 JavaScript 推論使用相同特徵定義；匯出預測已與 scikit-learn 比對。
- 所有圖片準備、標註、訓練與推論皆在本機完成，沒有啟用雲端訓練或付費 API。

## 資料品質與分割

使用者提供 20 張照片，即同一本英文課本的 10 組「作答照片＋其他工具清理結果」。第二張並非乾淨原稿：有殘影、被刪除的示範字、缺損框線，且拍攝幾何與光線不同。

先以特徵匹配、透視轉換及平滑的局部對齊建立比較座標，再根據目視檢查的手寫／保留區域製作**稀疏弱標註**。對齊不確定、仍有殘影與重疊處忽略；已印好的示範字明確列為保留，即使比較圖片將它刪掉。這不是逐像素人工完整標註，也不是將另一個工具的輸出直接當作正確答案。

按整頁分割，避免同頁切片同時進入訓練與評估：

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

十張本機照片皆經 Chromium 的實際 ONNX、補強分類器及 OpenCV 修補。稀疏標註只用來比較相同區域的新舊版本，不能稱作整頁清除率。更暗／更淡的筆跡、反光、插圖上的圈線、同字形示範字及導線交界仍可能殘留或誤選。最終發布檢查見 `docs/v0.6.0-validation.json`。

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
