## 1. Sheets Schema 更新

- [x] 1.1 修改 `src/gas/init_sheets.js` SCHEMA 常數：Action_Backlog 移除 GCal_Link，新增 Slack_Notified（col6）、Slack_Notified_At（col7）、Status（col8）
- [x] 1.2 修改 `src/gas/init_sheets.js` SCHEMA 常數：Interaction_Timeline 新增 Edit_Log（col8）
- [ ] 1.3 在 GAS 編輯器備份現有 Sheets 資料後執行 `initSheetStructure()`，確認四張表欄位正確

## 2. NLU System Prompt 更新

- [x] 2.1 更新 `src/nlu/system_prompt.md`：新增「Entity 匹配規則」區段（matched_entity_id、entity_match_confidence 邏輯說明）
- [x] 2.2 更新 `src/nlu/system_prompt.md`：新增 Grounding Context 格式說明（`## 現有客戶名單` 區塊）
- [x] 2.3 更新 `src/nlu/system_prompt.md`：JSON 輸出格式 `tasks[]` → `actions[]`，欄位改名 ref_entity→entity_name、task_detail→action_description、due_date→action_date
- [x] 2.4 更新 `src/nlu/system_prompt.md`：新增頂層欄位 `overall_confidence`、`missing_fields` 的規格說明
- [x] 2.5 更新 Few-Shot 範例中的輸出 JSON 以符合新格式

## 3. gemini_nlu.js 更新

- [x] 3.1 更新 `SYSTEM_PROMPT` 常數，與 `src/nlu/system_prompt.md` 同步
- [x] 3.2 新增 `buildGroundingContext_()` 函式：從 Entity_Index sheet 讀取最多 200 筆，格式化為純文字清單
- [x] 3.3 新增公開函式 `parseOnly(rawText)`：呼叫 `buildGroundingContext_()` 取得 grounding，附加至 system prompt 末尾，再呼叫 Gemini API
- [x] 3.4 修改內部 `callGeminiNLU_()` 簽名為 `callGeminiNLU_(rawText, groundingContext)`，接受動態 grounding
- [ ] 3.5 在 GAS 編輯器執行 `testParseOnly()`，確認回傳 JSON 包含 `overall_confidence`、`missing_fields`、`matched_entity_id`

## 4. slack_notifier.js 新增

- [x] 4.1 建立 `src/gas/slack_notifier.js`，實作 `getSlackUserId_()` 函式（lookup by email + Script Properties 快取）
- [x] 4.2 實作 `postMessage_(channel, blocks)` 函式，含 HTTP 429 Retry-After 重試邏輯（最多 3 次）
- [x] 4.3 實作 `buildConfirmationBlocks_(actionData)` 函式，生成 Slack Block Kit 格式的確認訊息
- [x] 4.4 實作 `sendConfirmation(actionData)` 公開函式：取得 User ID → 建構 blocks → postMessage → 回傳成功/失敗狀態
- [x] 4.5 實作 `buildReminderBlocks_(actionItems, mode, dateRangeLabel)` 函式
- [x] 4.6 實作 `sendReminder(actionItems, mode, dateRangeLabel)` 公開函式
- [x] 4.7 在 GAS Script Properties 設定 `SLACK_BOT_TOKEN`、`USER_EMAIL`，執行 `testSlackNotifier()` 確認 DM 送達

## 5. dispatcher.js 更新

- [x] 5.1 新增 `confirmWrite(confirmedData)` 函式：依 `intents` 路由至各 handler（`handleCreateEntity_`、`handleUpdatePipeline_`、`handleLogInteractions_`、`handleScheduleActions_`）
- [x] 5.2 更新 `handleLogInteractions_()` 函式：寫入 Interaction_Timeline 第 8 欄（Edit_Log）
- [x] 5.3 更新 `handleScheduleActions_()` 函式：移除 GCal 邏輯，改寫 Slack_Notified=false、Status=pending 至 Action_Backlog col6-8；寫入後呼叫 `sendConfirmation()`
- [x] 5.4 新增 `retrySlack(actionData)` 函式：呼叫 `sendConfirmation()`，成功後更新 Action_Backlog 對應列的 Slack_Notified/Slack_Notified_At
- [x] 5.5 更新 `doPost()` 路由：新增 `parseOnly`、`confirmWrite`、`retrySlack` action；移除舊版 `processRawText` 路由
- [ ] 5.6 在 GAS 編輯器執行 `testConfirmWrite()`，確認 Sheets 正確寫入且 Slack 通知送出

## 6. weekly_reminder.js 新增

- [x] 6.1 建立 `src/gas/weekly_reminder.js`，實作 `setupWeeklyTriggers()` 函式（建立週五 18:00 + 週一 08:00 兩個 Time-driven Trigger）
- [x] 6.2 實作 `deleteWeeklyTriggers()` 函式，清除所有 weekly reminder triggers
- [x] 6.3 實作 `getDateRange_(mode)` 函式：mode='friday' 回傳下週 Mon-Sun 範圍；mode='monday' 回傳本週 Mon-Sun 範圍
- [x] 6.4 實作 `fetchPendingActions_(startDate, endDate)` 函式：從 Action_Backlog 批次讀取（上限 50 列）Status=pending 且 Due_Date 在範圍內的記錄
- [x] 6.5 實作 `sendFridayPreview()` 和 `sendMondayConfirm()` 函式，呼叫 `sendReminder()`
- [x] 6.6 在 GAS 編輯器執行 `setupWeeklyTriggers()`，確認 Triggers 清單有兩個新觸發器

## 7. frontend.html SPA 狀態機重構

- [x] 7.1 重寫 `src/gas/frontend.html`：建立 7 個狀態面板 HTML 結構（INPUT、LOADING、PREVIEW、EDITING、CONFIRMING、RESULT、ERROR）
- [x] 7.2 實作 `appState` 物件與 `setState(newState)` 函式（CSS active class 控制面板顯示）
- [x] 7.3 實作 INPUT 面板：文字輸入框 + 「解析」按鈕，點擊後切換至 LOADING 並呼叫 `parseOnly()`
- [x] 7.4 實作 PREVIEW 面板：依 `intents` 渲染 Parsed Summary 卡片；`overall_confidence < 0.50` 顯示紅色警告 Banner 並自動切換至 EDITING
- [x] 7.5 實作 Entity Disambiguation Banner（≥0.80 綠色標籤；0.50–0.79 黃色確認選項；<0.50 新客戶）
- [x] 7.6 實作 EDITING 面板：可編輯欄位 + `edit_log` 追蹤每次修改（`{field, original, modified}`）
- [x] 7.7 實作 CONFIRMING 面板：呼叫 `confirmWrite(confirmedData)`（含 edit_log）
- [x] 7.8 實作 RESULT 面板：顯示成功訊息；`partial_success` 時顯示「重試通知」按鈕（呼叫 `retrySlack()`）
- [x] 7.9 實作 ERROR 面板：顯示錯誤訊息 + 「重試」按鈕 + 「返回輸入」按鈕
- [x] 7.10 端對端測試：在瀏覽器完整走過 INPUT→PREVIEW→EDITING→CONFIRMING→RESULT 流程，確認 Sheets 資料與 Slack 通知正確

## 8. 部署與收尾

- [x] 8.1 更新 `src/gas/appsscript.json`：移除 Google Calendar OAuth scope，確認 Sheets 與 UrlFetch scopes 存在
- [x] 8.2 執行 `clasp push` 部署所有檔案至 GAS
- [x] 8.3 在 GAS 部署介面建立新版本 Web App（版本號遞增，存取權限：任何人）
- [x] 8.4 執行 `setupWeeklyTriggers()` 設定每週提醒觸發器
- [x] 8.5 進行使用者驗收測試（UAT）：主幹流程（INPUT→PREVIEW→CONFIRMING→RESULT）驗證通過

## 9. Post-UAT Open Items（下一個 Sprint）

- [ ] 9.1 **Preview UI 調整**：使用者反饋 Preview 畫面顯示細節需優化（具體項目待下次 session 確認）
- [ ] 9.2 **Entity Grounding 強化**：同一家客戶在下次輸入時，有機率未被辨認為同一 Entity 導致重複建立，需改進 matched_entity_id 匹配邏輯
- [ ] 9.3 **Strategic Pipeline 寫入規則**：AI 判斷何時更新現有 Pipeline vs 新建一筆的規則尚不精準，需定義明確的 merge/create 決策邏輯後再驗證
