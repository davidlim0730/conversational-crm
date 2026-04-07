## ADDED Requirements

### Requirement: 前端具備 7 個狀態面板
系統 SHALL 以 SPA 方式實作前端，包含以下狀態面板：INPUT、LOADING、PREVIEW、EDITING、CONFIRMING、RESULT、ERROR。任何時刻只有一個面板可見（CSS `active` class 控制顯示）。

#### Scenario: 初始載入
- **WHEN** 使用者開啟 Web App
- **THEN** 只有 INPUT 面板可見，其餘面板隱藏

#### Scenario: 狀態切換
- **WHEN** `setState(newState)` 被呼叫
- **THEN** 前一個面板移除 `active`，新面板加上 `active`

### Requirement: INPUT → LOADING → PREVIEW 流程
系統 SHALL 在使用者提交文字後，切換至 LOADING 狀態並呼叫 `parseOnly()`，成功後切換至 PREVIEW 顯示解析結果。

#### Scenario: 提交成功
- **WHEN** 使用者點擊「解析」按鈕（輸入框非空）
- **THEN** 切換至 LOADING，呼叫 `google.script.run.withSuccessHandler(...).parseOnly(text)`，成功後切換至 PREVIEW

#### Scenario: 提交空白輸入
- **WHEN** 使用者點擊「解析」但輸入框為空
- **THEN** 保持 INPUT 狀態，顯示提示訊息，不呼叫 API

#### Scenario: API 呼叫失敗
- **WHEN** `parseOnly()` 回傳錯誤或網路逾時
- **THEN** 切換至 ERROR 狀態，顯示錯誤訊息

### Requirement: PREVIEW 顯示 Parsed Summary 卡片
系統 SHALL 在 PREVIEW 面板中，依 `intents` 陣列為每個觸發的意圖渲染一張摘要卡片，顯示解析出的關鍵欄位值。

#### Scenario: 多意圖觸發
- **WHEN** NLU 回傳 `intents: ["CREATE_ENTITY", "UPDATE_PIPELINE", "LOG_INTERACTION", "SCHEDULE_ACTION"]`
- **THEN** PREVIEW 面板顯示 4 張對應卡片，每張卡片顯示對應 intent 的解析欄位

#### Scenario: 單意圖觸發
- **WHEN** NLU 只回傳 1 個 intent
- **THEN** PREVIEW 面板只顯示 1 張卡片

### Requirement: NLU 低信心時顯示警告 Banner 並自動進入 EDITING
系統 SHALL 在 `overall_confidence < 0.50` 時，於 PREVIEW 面板頂部顯示紅色警告 Banner（「AI 解析信心不足，建議手動確認」），並自動切換至 EDITING 狀態。

#### Scenario: overall_confidence < 0.50
- **WHEN** NLU 回傳 `overall_confidence < 0.50`
- **THEN** 顯示紅色警告 Banner，並自動切換至 EDITING 狀態

#### Scenario: overall_confidence ≥ 0.50
- **WHEN** NLU 回傳 `overall_confidence ≥ 0.50`
- **THEN** 正常顯示 PREVIEW，不自動進入 EDITING

### Requirement: Entity Disambiguation Banner
系統 SHALL 在 PREVIEW/EDITING 面板中，對每個 entity 依 `entity_match_confidence` 顯示對應的 Disambiguation UI：
- ≥ 0.80：綠色標籤「已匹配：{Entity_Name}」
- 0.50–0.79：黃色確認 Banner「是否為 {Entity_Name}？[是] [否，建立新客戶]」
- < 0.50 或 null：無特殊標示（視為新客戶）

#### Scenario: 高信心匹配
- **WHEN** entity.entity_match_confidence ≥ 0.80
- **THEN** 顯示綠色「已匹配：{matched entity name}」標籤，不需使用者操作

#### Scenario: 中信心匹配
- **WHEN** entity.entity_match_confidence 在 0.50–0.79
- **THEN** 顯示黃色確認 Banner，使用者須選擇「是」或「否，建立新客戶」後才能進入 CONFIRMING

#### Scenario: 低信心或新客戶
- **WHEN** entity.entity_match_confidence < 0.50 或 matched_entity_id 為 null
- **THEN** 不顯示 Disambiguation Banner，直接視為新客戶

### Requirement: EDITING 狀態追蹤 edit_log
系統 SHALL 在 EDITING 狀態中，追蹤使用者對解析結果的每一筆修改，儲存為 `edit_log: [{field, original, modified}]`，並在切換至 CONFIRMING 時隨 `confirmedData` 一起提交。

#### Scenario: 使用者修改欄位
- **WHEN** 使用者在 EDITING 面板修改任一欄位值
- **THEN** `edit_log` 新增一筆 `{field: "欄位名", original: "原值", modified: "新值"}`

#### Scenario: 使用者未修改直接確認
- **WHEN** 使用者從 PREVIEW 直接點「確認寫入」（未進入 EDITING）
- **THEN** `edit_log` 為空陣列 `[]`

### Requirement: CONFIRMING → RESULT / ERROR 流程
系統 SHALL 在使用者點擊「確認寫入」後，切換至 CONFIRMING 狀態並呼叫 `confirmWrite(confirmedData)`，成功後切換至 RESULT，失敗後切換至 ERROR。

#### Scenario: 寫入成功（完整）
- **WHEN** `confirmWrite` 回傳 `status: "ok"`
- **THEN** 切換至 RESULT，顯示「已成功寫入，Slack 通知已送出」

#### Scenario: 寫入成功但 Slack 失敗（partial_success）
- **WHEN** `confirmWrite` 回傳 `status: "partial_success"`
- **THEN** 切換至 RESULT，顯示「已寫入，Slack 通知失敗」，提供「重試通知」按鈕

#### Scenario: 寫入失敗
- **WHEN** `confirmWrite` 回傳 `status: "error"`
- **THEN** 切換至 ERROR 狀態，顯示錯誤訊息

### Requirement: ERROR 狀態提供重試與返回選項
系統 SHALL 在 ERROR 面板提供「重試」按鈕（重新執行失敗的操作）與「返回輸入」按鈕（切換至 INPUT 狀態並清空輸入框）。

#### Scenario: 使用者點「重試」
- **WHEN** 使用者在 ERROR 狀態點擊「重試」
- **THEN** 根據錯誤來源（parseOnly 或 confirmWrite）重新執行對應操作

#### Scenario: 使用者點「返回輸入」
- **WHEN** 使用者在 ERROR 狀態點擊「返回輸入」
- **THEN** 切換至 INPUT 狀態，清空輸入框，重置 appState
