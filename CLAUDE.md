# Conversational CRM — The 3-Minute Ritual

## 專案概述

讓 BD 人員（使用者：小王）在拜訪客戶後，透過「意識流」文字輸入，自動完成 CRM 資料結構化更新與行程安排，消除手動填寫表單的行政負擔。

---

## 系統架構（目前：Architecture A）

```
瀏覽器（GAS Web UI）
    ↓
Google Apps Script (dispatcher.js)
    ↓              ↓
Gemini API     Google Sheets / Google Calendar
(gemini_nlu.js)    (4 張表：Entity / Pipeline / Timeline / Backlog)
```

**架構決策：** 目前使用 Full GAS Stack（Phase 1 MVP）。
**未來升級路徑：直接遷移至 Architecture C**（標準後端 + Google APIs 直接串接），跳過混合架構。

---

## 檔案職責

| 檔案 | 職責 |
|------|------|
| `src/gas/dispatcher.js` | Web App 入口（`doPost` / `doGet`）、意圖路由、Sheets 讀寫、GCal 串接 |
| `src/gas/gemini_nlu.js` | 呼叫 Gemini API，將原始文字轉為結構化 JSON |
| `src/gas/frontend.html` | 極簡文字輸入頁面（內嵌於 GAS Web App） |
| `src/gas/init_sheets.js` | 初始化 Google Sheets 四張表的欄位結構與驗證 |
| `src/gas/appsscript.json` | GAS manifest（時區、OAuth scopes） |
| `src/nlu/system_prompt.md` | Gemini 的 system prompt（**這是原始碼，不是文件**） |
| `src/nlu/prompt_v1.md` | 舊版 prompt 備份 |

---

## 部署方式

此專案使用 [clasp](https://github.com/google/clasp) 管理 GAS 程式碼版本。

```bash
# 推送至 GAS
clasp push

# 在 GAS 編輯器手動部署：
# 部署 → 新增部署 → Web 應用程式 → 存取權限：「任何人」
```

`rootDir` 設定為 `src/gas/`（見 `.clasp.json`）。

---

## 開發進度

- [x] **Phase 1** — Git 初始化、Sheets 初始化腳本
- [x] **Phase 2** — NLU 模組（Gemini prompt、text-to-JSON）
- [x] **Phase 3** — GAS Dispatcher（路由、Fuzzy Matching、Sheets 寫入、GCal 串接）
- [x] **Phase 4（部分）** — 前端 Web UI、端對端串接
- [ ] **Phase 4（待完成）** — 解析結果預覽 UI + 確認寫入、使用者驗收測試、Latency 優化
- [ ] **Phase 5（未開始）** — RAG/Grounding：將現有 Entity 名單動態注入 Gemini Prompt

---

## 程式碼規範

**Commit message 格式：**
```
feat: 新功能
fix: 修 bug
refactor: 重構
docs: 文件
chore: 雜項（設定、依賴）
```

**語言規範：**
- 變數名、函式名：英文
- UI 顯示文字：中文
- 程式碼註解：中文（方便 BD 背景的 stakeholder 閱讀）

---

## GAS 開發注意事項

- **無本地測試環境**：邏輯驗證在 GAS 編輯器執行，或透過獨立 Node.js 腳本模擬。
- **執行時間上限**：單次 GAS 執行最長 6 分鐘，避免在單一函式內做大量迴圈。
- **`src/nlu/*.md` 是原始碼**：Gemini prompt 檔案屬於程式邏輯，修改需與程式碼一起 commit。
- **Sheets 作為唯一持久層**：目前無獨立資料庫，所有狀態存於 Google Sheets。

---

## AI 回覆規範

- **直接給結果**：不要前言、不要總結
- **使用工具後，只回報結果**：不描述過程
- **除非主動問，否則不解釋**：不說明你在做什麼
- **程式碼和資料維持完整精確**：只壓縮自然語言


