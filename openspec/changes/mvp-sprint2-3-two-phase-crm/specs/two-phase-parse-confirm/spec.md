## ADDED Requirements

### Requirement: parseOnly 執行 NLU 但不寫入資料
系統 SHALL 提供 `parseOnly(rawText)` GAS 函式，接受原始文字輸入，呼叫 Gemini NLU，回傳結構化 JSON，但不對 Google Sheets 或任何外部服務執行任何寫入操作。

#### Scenario: 成功解析
- **WHEN** `doPost` 收到 `action: "parseOnly"` 請求
- **THEN** 呼叫 Gemini NLU 並回傳 `{status: "ok", data: <NLU JSON>}`，不修改任何 Sheet

#### Scenario: NLU API 失敗
- **WHEN** Gemini API 回傳錯誤或非 JSON 格式
- **THEN** 回傳 `{status: "error", message: "NLU 解析失敗"}` 且不寫入任何資料

### Requirement: confirmWrite 接受確認資料並執行寫入
系統 SHALL 提供 `confirmWrite(confirmedData)` GAS 函式，接受使用者確認（或修改）後的 NLU JSON，依 `intents` 陣列寫入對應 Sheets，並呼叫 Slack 通知。

#### Scenario: 完整寫入成功
- **WHEN** `doPost` 收到 `action: "confirmWrite"` 且所有 Sheets 寫入成功、Slack 通知成功
- **THEN** 回傳 `{status: "ok", written: [...], slackSent: true}`

#### Scenario: Sheets 寫入成功但 Slack 失敗
- **WHEN** Sheets 寫入成功但 Slack API 回傳錯誤
- **THEN** 回傳 `{status: "partial_success", written: [...], slackSent: false, slackError: "..."}`，不 rollback Sheets

#### Scenario: Sheets 寫入失敗
- **WHEN** Google Sheets API 拋出例外
- **THEN** 回傳 `{status: "error", message: "..."}` 並停止後續操作（不呼叫 Slack）

### Requirement: edit_log 記錄使用者修改
系統 SHALL 在 `confirmWrite` 時，若 `confirmedData` 包含 `edit_log` 欄位，將其以 JSON 字串寫入 Interaction_Timeline 表的 Edit_Log 欄（第 8 欄）。

#### Scenario: 使用者有修改紀錄
- **WHEN** `confirmedData.edit_log` 為非空陣列
- **THEN** Edit_Log 欄寫入 `JSON.stringify(edit_log)`

#### Scenario: 使用者未修改
- **WHEN** `confirmedData.edit_log` 為空陣列或未提供
- **THEN** Edit_Log 欄寫入空字串 `""`

### Requirement: retrySlack 重試失敗的 Slack 通知
系統 SHALL 提供 `retrySlack(actionData)` GAS 函式，對指定 Action_Backlog 記錄重新發送 Slack 通知，成功後更新 Slack_Notified=true、Slack_Notified_At=現在時間。

#### Scenario: 重試成功
- **WHEN** `doPost` 收到 `action: "retrySlack"` 且 Slack API 呼叫成功
- **THEN** 更新 Action_Backlog 對應列的 Slack_Notified=true、Slack_Notified_At，回傳 `{status: "ok"}`

#### Scenario: 重試失敗
- **WHEN** Slack API 再次失敗
- **THEN** 回傳 `{status: "error", message: "..."}` 且不修改 Sheets
