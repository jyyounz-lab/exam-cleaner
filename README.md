# 再練一張 · 考卷筆跡清理

依 v1.1 規劃製作的瀏覽器本機工具。流程為：保留原圖 → 校正 → AI 優先 → 半自動調整 → 手動精修 → 確認匯出。AI 結果滿意即可直接匯出，後兩層按需使用。

目前為 **0.1.0 實驗版**，已整合真正的預訓練分割模型，並非把色彩規則稱為 AI。中文兒童考卷品質、iPhone／Android 實機速度仍待驗收；無法保證恢復被手寫完全遮住的題目。

## 執行

需要 Node.js 22.12 以上，建議 Node.js 24 LTS。

```powershell
npm ci
npm run prepare:runtime
npm run dev -- --port 4173
```

開啟 `http://127.0.0.1:4173/`。正式建置與離線測試：

```powershell
npm run build
npm run preview -- --port 4174
```

開啟 `http://127.0.0.1:4174/`。靜態發布使用 `dist/` 全部內容，須以 HTTPS 提供服務；本機 localhost 可使用 HTTP。正式版資源快取完成、頁尾顯示「工具與 AI 已可離線使用」後，才可關閉網路。開發模式不註冊 Service Worker。

## 使用

1. 選擇 JPG／PNG 或拍照，也可使用工具內建的合成示範考卷。
2. 四角對齊考卷，旋轉方向，按「完成校正，開始 AI 分析」。
3. 檢查紅色待清除遮罩與清除預覽；AI 結果滿意即可確認匯出。
4. 半自動層可調整 AI 門檻、補選紅／藍筆跡及限定處理範圍。框選本身不會擦掉整塊題目。
   實驗模型可能誤選中文與數學符號，因此預設保留黑／灰色墨色。需處理黑筆或鉛筆時，先圈定答案區，再勾選納入黑／灰色候選；區域內仍須人工確認。
5. 手動層可補擦、還原、保留及取消保留；支援復原／重做、100%～800% 縮放、移動與雙指縮放。
6. 匯出視窗比較清除前後，勾選已檢查，再下載 JPG 或 A4 PDF。
7. 「下載原圖」提供匯入的原始檔案；「儲存進度」保存目前原圖、校正底圖、AI 機率與編輯歷史於此瀏覽器。

## 原圖、隱私與資料

- 原始 `File` 不重新編碼；原圖下載與輸出成果分開。所有清除從未清除的校正底圖與分層遮罩重新合成。
- AI、半自動、手動共用同一個最終遮罩。膨脹之後再次扣除人工保留、排除及 AI 印刷保護區。
- 中性墨色（通道差小於 26 且最小通道小於 245）預設保留，避免研究模型直接損壞中文與數學符號。明確的手動補擦不受此自動保護限制，人工保留與啟用的 AI 印刷保護仍優先。
- OpenCV 修補後將遮罩外像素精確取回底圖；JPEG 本身為有損格式，編碼後的像素可能有微小差異。
- 不設圖片上傳 API、雲端 AI、登入資料庫或分析追蹤。執行時下載的只有本站程式、影像引擎與模型。
- AI 模型約 1.13 MiB；完整網站、OpenCV 與 ONNX WASM 約 30 MB，首次離線準備需要連線與儲存空間。
- 圖片限制：35 MB、最多 6400 萬像素。工作與輸出長邊以約 2000 px 為上限；原圖原始資料獨立保留。瀏覽器仍可能在解碼時需要較多記憶體。
- 暫存使用 IndexedDB，可能因空間不足、清除網站資料、瀏覽器策略或換裝置而遺失。請下載重要原圖與成果。匯出的 JPG／PDF 不包含可繼續編輯的遮罩。
- Service Worker 只快取本站的已知程式與模型資源，版本以內容雜湊區分，只清理本工具的舊版快取。原始考卷不放入服務工作者的資源快取。

## 模型與驗證範圍

模型採 [PHTI-WS / printed-hw-segmentation](https://github.com/Jumpst3r/printed-hw-segmentation) 的 MIT 預訓練 FCNN，固定來源 commit，直接讀 H5 權重重建 ONNX。輸出印刷／手寫／背景三類機率，影像清除另由 OpenCV Telea 完成。

- 原始與轉換模型 SHA、預處理與契約：`public/models/metadata.json`。
- 授權：`public/models/PHTI-LICENSE.txt`。
- 轉換方法、私人訓練資料限制與來源範例測試：`research/MODEL-CARD.md`。
- NumPy 等效原架構與 ONNX CPU 最大誤差約 `6.56e-7`；這是轉換等效性，並非考卷清除準確率。
- 作者公開英文範例的指定 crop 已做 smoke test；非獨立中文兒童考卷品質證據。
- Chrome 本機 WASM 已實際執行，示範考卷約 35 tiles、單執行緒約 17 秒；依硬體而異，不保證手機速度。

## 驗證指令

```powershell
npm test
npm run build
node scripts/browser-qa.mjs
```

瀏覽器測試需先啟動正式預覽 4174，第一次使用可執行 `npx playwright install chromium`，或以 `BROWSER_PATH` 指定既有 Chromium。`APP_URL` 可指定測試網址。測試使用合成考卷，只在本機處理，結果寫入未納入版本控制的 `test-results/`。

測試涵蓋遮罩保護優先、區域限制、候選增減、復原／重做、Sauvola 預處理、四角驗證、實際 ONNX WASM、OpenCV 修補、響應式介面、原圖位元組保持不變、進度恢復、確認後 JPG／PDF、觸控縮放、離線重新推論與 AI 失敗替代模式。

## 實作選擇與後續

React + TypeScript + Vite、ONNX Runtime Web、OpenCV.js、pdf-lib。單一原生 Canvas 負責四角及遮罩操作，取代規劃中 Cropper／Fabric 的雙 Canvas 組合，以集中座標與遮罩狀態；不額外建立重複編輯狀態。簡單進度儲存採 IndexedDB，暫不加入 OPFS。

待續工作：真實中文／注音／數學考卷品質集、手機實機效能、WebGPU、可靠自動紙張外框、進階去陰影、連通元件篩選、多頁 PDF、可攜式編輯專案備份及瀏覽器儲存容量管理。P0 操作流程可試用，正式品質指標以後續驗收為準。

部署設定保存在 `.openai/hosting.json`；Sites 新建網站預設為私人。`public/_headers` 亦提供 Cloudflare Pages 所需的跨來源隔離與 CSP 設定。WASM 基線為單執行緒，不依賴 WebGPU 或跨來源隔離才能運作。
