# 3-Minute Ritual (Invisible CRM) - Product Implementation Plan

## 1. 產品目標
為資深 BD（小王）打造一個「隱形 CRM」，透過意識流的文字輸入，自動將非結構化對話轉換為 Google Sheets 中的結構化數據與 Google Calendar 行程。

## 2. 系統架構 (System Architecture)
採用 Agentic Workflow，將輸入、解析、調度、儲存分離。

- **Input**: 透過簡單文字框（暫定）輸入 Raw Text。
- **Parser**: 使用 **Gemini 2.5 Flash** 設計 NLU Logic，將文字轉化為結構化 JSON 指令。
- **Dispatcher (GAS)**: 接收指令，執行 Google Sheets 讀寫與 Google Calendar API 調用。
- **Storage**: 以 Google Sheets 作為持久層，分為 Entity、Pipeline、Timeline、Backlog 四張表。

## 3. 開發階段 (Development Phases)

### Phase 1: 基礎建設與版本管理 (Infra & Git)
- [x] 初始化 Git 儲存庫。
- [ ] 撰寫 Google Sheets 初始化腳本 (GAS)。
- [ ] 定義專案目錄結構。

### Phase 2: NLU 解析模組 (Gemini NLU)
- [ ] 精煉 System Prompt（意圖路由 + 實體提取）。
- [ ] 實作 Text-to-JSON 介面。
- [ ] 測試「Acer」、「台積電」等情境數據。

### Phase 3: 資料調度器 (GAS Dispatcher)
- [ ] 實作 `doPost` 接口接收 Gemini 輸出。
- [ ] 實作 Fuzzy Matching (如 台積 -> 台積電)。
- [ ] 實作 Sheets 寫入邏輯 (`appendRow`, `updateRow`)。
- [ ] 實作 Google Calendar 排程與 URL 回填。

### Phase 4: 前端入口與端對端整合 (Integration)
- [ ] 建立極簡文字輸入頁面（或 CLI 測試工具）。
- [ ] 串接「輸入 -> NLU -> GAS -> Sheets/Calendar」完整路徑。
- [ ] 進行使用者案例驗證 (The 3-Minute Ritual Workflow)。

## 4. 版本控制規範 (Git Rules)
- 每次完成一個小模組（如 GAS 腳本、Prompt 調整）需進行 commit。
- 使用明確的 Commit Message 範例：`feat: implement fuzzy matching in GAS`, `refactor: optimize NLU prompt`.

## 5. 資料庫規格 (Sheets Schema)
（依照原始需求定義 Entity_Index, Strategic_Pipeline, Interaction_Timeline, Action_Backlog 欄位）
