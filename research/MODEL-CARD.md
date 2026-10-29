# PHTI FCNN 本機筆跡分割模型：轉換與限制

狀態：**實驗模型**。已完成固定來源權重下載、H5 → ONNX 轉換、ONNX checker、CPU 推論及獨立 NumPy 等效圖數值比對。中文兒童考卷品質與手機實機速度仍待驗證。

產品整合已實際通過本機 Chromium ONNX Runtime Web WASM 推論及快取後離線重新推論。英文研究模型會誤選部分中文／數學符號，產品預設保留中性墨色；黑筆／鉛筆候選需由使用者圈定答案區後啟用。這是保守的產品保護條件，並非已達到中文考卷模型品質指標。

## 來源與授權

- 上游：[Jumpst3r/printed-hw-segmentation](https://github.com/Jumpst3r/printed-hw-segmentation)，PHTI-WS（ICDARW 2019）。
- 固定 commit：`b23f26c2490e55fea64bc1e9b5676bf07fbb2f9b`。
- [原始權重下載](https://raw.githubusercontent.com/Jumpst3r/printed-hw-segmentation/b23f26c2490e55fea64bc1e9b5676bf07fbb2f9b/FCN/models/fcnn_bin.h5)：3,624,072 bytes。
- 原始 H5 SHA-256：`a4fbfc32291159114f7d65014ac9fa33c0f3e296e3271b136fa2d3152d8b2f00`。
- 轉換後 ONNX：`public/models/phti-fcnn.onnx`，1,184,717 bytes。
- ONNX SHA-256：`42c370c5517d897362981e026a940b6e26ed3121bf1cfe70e868d8eac62e0022`。
- 儲存庫為 MIT，Copyright (c) 2019 Nicolas Dutly；權重包含在同一儲存庫，未見權重另有排除條款。原始授權完整保留於 `public/models/PHTI-LICENSE.txt`。
- 作者訓練、驗證及測試資料為私人資料集，README 說明需申請取得；這份轉換未取得或重新散布私人資料集。程式／模型的 MIT 授權不等於訓練資料另外獲得公開授權。
- 作者公開範例 `docker/code/input.png` 與 `mask.png` 僅下載至 research 作推論測試，不隨網站公開發送。

## 執行契約

| 項目 | 值 |
|---|---|
| 輸入名稱 | `image` |
| 輸入 | float32 NCHW `[1, 3, 256, 256]` |
| 輸出名稱 | `probabilities` |
| 輸出 | float32 NCHW `[1, 3, 256, 256]` |
| 類別索引 | 0 印刷、1 手寫、2 背景 |
| 模型圖 | opset 13、IR version 8；Conv、Relu、MaxPool、ConvTranspose、Add、Softmax、Identity |

模型沒有內建影像正規化。應按照上游 `FCN/img_utils.py` 與 `classifier_fcnn.py` 預處理：

1. RGB 除以 255 取得 `[0,1]` float，灰階係數使用 `[0.2125,0.7154,0.0721]`。
2. 全圖 Sauvola 二值化：window 15、k 0.2；灰階 float 對應原 skimage dtype 範圍 `[-1,1]`，故 **R=1.0**。邊界採 reflect。公式 `T = mean * (1 + 0.2 * (std / 1.0 - 1))`。
3. `ink = grayscale < T`：墨色像素為 **1**，紙張為 **0**。
4. 取 256×256 tile，原始程式 stride 246；可使用重疊切片並融合機率，避免接縫。
5. 每 tile 分別計算二值圖的 population mean、std（包含 padding），`z = (ink - mean) / std`；std 為 0 時以 1 代入。
6. 將 z 複製至三個相同通道，排列為 NCHW。
7. 每 tile 回傳三類機率。手寫候選取 channel 1，印刷保護候選取 channel 0。機率只用於候選與使用者檢視，不是正確率保證。

原始上游程式把邊界 padding 設成 1，與其 ink=1 語義矛盾。網站可改成白紙 0 並記錄此邊界處理差異；這項變動不影響 ONNX 權重轉換的等效性。若改用其他二值化、縮放或融合方式，應另外測量品質。

## 轉換方法與驗證

`convert_phti.py` 只讀取 H5 的 `model_config` 與 `model_weights`，沒有執行 pickle，也沒有載入訓練程式。將 Keras NHWC 卷積核映射到 ONNX NCHW，移除推論時的 Dropout 與 optimizer state，保留所有 inference 權重。

轉換使用 h5py、onnx、onnxruntime、NumPy；未安裝 TensorFlow。獨立參考實作以 NumPy NHWC 的 sliding window、tensor dot、轉置卷積 scatter、pooling、skip addition 與 softmax 計算整個原圖，對比 ONNX CPU 輸出。

- ONNX checker 與 shape inference：通過。
- 輸出範圍、有限值及每像素三類加總：通過，softmax 最大誤差約 `1.2e-7`。
- 獨立 NumPy 整圖與 ONNX CPU：最大絕對誤差約 `6.6e-7`。
- 不同輸入輸出有變化，最大機率差約 `0.9824`。
- 作者公開真實英文掃描頁：印刷區墨色像素平均手寫機率約 `0.0493`，手寫區約 `0.9312`。只是兩個指定 crop 的 smoke test，該頁可能是作者展示資料，**不是獨立泛化品質分數**。
- 完整數值及工具版本見 `conversion-validation.json` 與 `public/models/metadata.json`。
- 未與原 TensorFlow/Keras runtime 比對；NumPy 參考實作對照的是原 H5 架構與權重。

## 重現

在此目錄使用 Python 3.12 執行：

```powershell
python -m pip install --target ./python-deps -r requirements.txt
python download_source.py
python convert_phti.py
```

這些是開發者離線轉換工具。網站只需 ONNX 檔與 ONNX Runtime Web，使用者照片保持在使用者瀏覽器。

## 產品限制

- 模型以作者的私人資料訓練，主要展示是英文混合印刷／手寫；中文、注音、數學、兒童鉛筆、彩色插圖、陰影及手機照片均需獨立測試。
- 印刷／手寫重疊可能產生錯誤，模型無法還原被遮住的原始題目像素。
- 模型輸出手寫區域候選，不直接生成題目或乾淨影像。清除應由確認後的遮罩及局部填補完成。
- 原圖需保持不變，保留區優先，所有清除可復原；AI 結果需在匯出前檢查。
- 本機 CPU 測試時間不能當作 iPhone／Android WASM／WebGPU 時間。
