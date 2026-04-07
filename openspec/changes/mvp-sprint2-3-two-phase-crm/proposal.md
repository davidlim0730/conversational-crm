## Why

現有 CRM 流程為一步式：使用者輸入文字 → 直接寫入 Sheets，無法預覽或修正 AI 解析結果，導致錯誤資料靜默寫入。此次升級引入「解析→預覽→確認→寫入」兩階段流程，並以 Slack Bot 取代 GCal 整合，降低維護複雜度、提升 BD 使用者信任感。

## What Changes

- **新增** `parseOnly()` GAS 函式：只執行 NLU，不寫入任何資料，回傳結構化 JSON 供前端預覽
- **新增** `confirmWrite()` GAS 函式：接受使用者確認後的資料，執行 Sheets 寫入 + Slack 通知
- **新增** `retrySlack()` GAS 函式：針對 Slack 通知失敗的任務進行重試
- **新增** `slack_notifier.js`：封裝 Slack Bot API（即時確認通知 + 每週批次提醒）
- **新增** `weekly_reminder.js`：Time-driven Trigger 設定（週五 18:00 預覽、週一 08:00 確認）
- **新增** Entity Grounding：`parseOnly()` 動態注入現有客戶名單至 Gemini prompt，輸出 `matched_entity_id` + `entity_match_confidence`
- **修改** `frontend.html`：從單頁輸入重構為 SPA 狀態機（INPUT→LOADING→PREVIEW→EDITING→CONFIRMING→RESULT/ERROR）
- **修改** `init_sheets.js`：Action_Backlog 移除 GCal_Link、新增 Slack_Notified/Slack_Notified_At/Status；Interaction_Timeline 新增 Edit_Log
- **修改** `system_prompt.md`：新增 Entity 匹配規則、更新 JSON 格式（tasks→actions，新增 overall_confidence/missing_fields/matched_entity_id/entity_match_confidence）
- **BREAKING** 移除 GCal 整合（`handleScheduleActions` 不再建立 Google Calendar 事件）
- **BREAKING** NLU 輸出格式變更：`tasks[]` → `actions[]`，欄位改名 ref_entity→entity_name、task_detail→action_description、due_date→action_date

## Capabilities

### New Capabilities
- `two-phase-parse-confirm`: 兩階段流程：parseOnly（NLU only）→ confirmWrite（Sheets+Slack），含預覽 UI 與 edit_log 追蹤
- `entity-grounding`: 動態將 Entity_Index 注入 Gemini prompt，輸出 matched_entity_id 與 entity_match_confidence，UI 依信心分數顯示自動匹配/需確認/新客戶
- `slack-notifications`: Slack Bot 即時確認通知與每週待辦提醒（週五預覽、週一確認），取代 GCal 整合
- `spa-state-machine`: 前端 SPA 狀態機（7 個狀態面板），含 Parsed Summary 卡片、Disambiguation Banner、NLU 低信心警告

### Modified Capabilities
- （無現有 spec 需修改）

## Impact

- **GAS 檔案**：init_sheets.js、gemini_nlu.js、dispatcher.js、frontend.html（修改）；slack_notifier.js、weekly_reminder.js（新增）
- **NLU**：system_prompt.md（原始碼，非文件）
- **Sheets Schema**：Action_Backlog 欄位結構異動（破壞性），需重新執行 `initSheetStructure()`
- **外部依賴**：新增 Slack Bot API（需在 GAS Script Properties 設定 `SLACK_BOT_TOKEN`、`USER_EMAIL`）
- **移除依賴**：Google Calendar API（`appsscript.json` 中的 Calendar scope 可移除）
