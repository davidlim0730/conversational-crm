## ADDED Requirements

### Requirement: confirmWrite 後發送 Slack 即時確認通知
系統 SHALL 在 `confirmWrite()` 成功寫入 Action_Backlog 後，呼叫 `sendConfirmation(actionData)` 向使用者（透過 Slack DM）發送通知，內容包含任務描述、關聯客戶、截止日期。

#### Scenario: 通知成功送出
- **WHEN** Slack API 回傳 `ok: true`
- **THEN** Action_Backlog 對應列的 Slack_Notified 設為 `true`，Slack_Notified_At 設為當前時間

#### Scenario: 通知失敗（API 錯誤或 Rate Limit）
- **WHEN** Slack API 回傳錯誤
- **THEN** Action_Backlog 對應列的 Slack_Notified 保持 `false`，Slack_Notified_At 為空，`confirmWrite` 回傳 `partial_success`

### Requirement: 依 USER_EMAIL 查找 Slack User ID 並快取
系統 SHALL 透過 Slack `users.lookupByEmail` API，依 Script Properties 中的 `USER_EMAIL` 查找對應的 Slack User ID，並將結果快取至 Script Properties（`SLACK_USER_ID`）以避免重複呼叫。

#### Scenario: 首次查找（快取為空）
- **WHEN** Script Properties 無 `SLACK_USER_ID`
- **THEN** 呼叫 Slack `users.lookupByEmail`，取得 User ID 後快取至 Script Properties

#### Scenario: 快取已存在
- **WHEN** Script Properties 有 `SLACK_USER_ID`
- **THEN** 直接使用快取值，不呼叫 Slack API

#### Scenario: EMAIL 不存在於 Slack Workspace
- **WHEN** `users.lookupByEmail` 回傳 `users_not_found` 錯誤
- **THEN** 拋出可辨識的錯誤訊息，`sendConfirmation` 回傳失敗狀態

### Requirement: Slack Rate Limit 自動重試
系統 SHALL 在 Slack API 回傳 HTTP 429（Too Many Requests）時，讀取 `Retry-After` header，等待對應秒數後重試，最多重試 3 次。

#### Scenario: Rate Limit 後重試成功
- **WHEN** 第一次請求回傳 429，重試後成功
- **THEN** 訊息正常送出，不向呼叫方回報錯誤

#### Scenario: 重試 3 次仍失敗
- **WHEN** 連續 3 次回傳 429 或其他錯誤
- **THEN** 拋出例外，上層 `sendConfirmation` 捕捉並回傳失敗狀態

### Requirement: 每週批次提醒（週五預覽 + 週一確認）
系統 SHALL 設定兩個 Time-driven Trigger：週五 18:00 執行 `sendFridayPreview()`（列出下週待辦），週一 08:00 執行 `sendMondayConfirm()`（確認本週待辦）。提醒內容從 Action_Backlog 查詢 Status=pending 且 Due_Date 在指定日期範圍內的記錄。

#### Scenario: 週五預覽有待辦事項
- **WHEN** 週五 18:00 觸發，Action_Backlog 有下週 pending 任務
- **THEN** 向使用者發送 Slack DM，包含所有待辦任務清單（Entity、描述、截止日）

#### Scenario: 週五預覽無待辦事項
- **WHEN** 週五 18:00 觸發，無下週 pending 任務
- **THEN** 發送「下週無待辦事項」訊息

#### Scenario: Trigger 設定
- **WHEN** `setupWeeklyTriggers()` 被執行
- **THEN** 建立週五 18:00 與週一 08:00 兩個 GAS Time-driven Trigger，可透過 `deleteWeeklyTriggers()` 移除

### Requirement: GCal 整合完全移除
系統 SHALL 不再為任何 Action_Backlog 記錄建立 Google Calendar 事件。Action_Backlog 表中不含 GCal_Link 欄位。

#### Scenario: 寫入 Action_Backlog
- **WHEN** `confirmWrite` 處理 SCHEDULE_ACTION 意圖
- **THEN** 寫入欄位為 Task_ID、Ref_Entity、Task_Detail、Due_Date、Reporter、Slack_Notified、Slack_Notified_At、Status，不含 GCal_Link
