# Conversational CRM — MVP Sprint 2 + 3 技術規格

**Author**: David Lin + Claude  
**Date**: 2026-04-07  
**Status**: Approved  
**Based on**: PRD_v2.md  
**Scope**: Sprint 2（NLU Grounding + Parsed Summary UI + Entity Disambiguation）+ Sprint 3（Dispatcher CRUD + Slack 整合 + 錯誤處理 + 降級 UX）

---

## 1. 架構總覽

### 產品方向變更

- **GCal → Slack**：MVP 以 Slack Bot 提醒取代 Google Calendar 整合。BD 的「下次行動」本質是任務提醒而非行事曆會議，Slack 更貼近實際工作流。GCal 降至 Phase 2 可選功能。
- **確認流程**：從「一步到位」改為「解析 → 預覽 → 確認 → 寫入」兩階段流程。

### 系統架構圖

```
[Mobile Web UI — frontend.html (SPA 狀態機)]
    │
    ├─ 1. 使用者輸入意識流文字
    │      ↓ google.script.run.parseOnly(rawText)
    │
    ▼
[GAS: gemini_nlu.js — parseOnly]
    │  動態注入 Entity_Index 全量名單至 System Prompt
    │  輸出: Structured JSON + confidence scores
    │
    ▼
[Mobile Web UI — PREVIEW 狀態]
    │  顯示 Parsed Summary 卡片
    │  所有欄位可 inline 編輯
    │  Entity Disambiguation 警示（confidence < 80%）
    │  NLU 降級提示（overall_confidence < 50%）
    │
    ├─ 使用者按「取消」→ 回到 INPUT 狀態
    ├─ 使用者修改欄位 → EDITING 狀態 → 修改完按「確認」
    │
    ▼
[GAS: dispatcher.js — confirmWrite(confirmedData)]
    │
    ├─ Step 1: Sheets CRUD（Entity / Pipeline / Interaction / Action）
    │     成功 ↓
    ├─ Step 2: Slack 即時確認通知
    │     失敗 → 回傳 partial success，前端顯示重試選項
    │
    ▼
[Mobile Web UI — RESULT 狀態]
    │  顯示寫入結果摘要 + Slack 狀態
    └─ 「繼續下一則」重置回 INPUT
```

### 檔案職責

| 檔案 | 狀態 | 職責 |
|------|------|------|
| `src/gas/frontend.html` | **重構** | SPA 狀態機：INPUT → LOADING → PREVIEW → EDITING → CONFIRMING → RESULT / ERROR |
| `src/gas/gemini_nlu.js` | **修改** | 新增 `parseOnly()` 公開函式；動態從 Entity_Index 讀取名單注入 prompt |
| `src/gas/dispatcher.js` | **修改** | 新增 `confirmWrite(confirmedData)` 公開函式；Staged Commit 改為 Sheets → Slack |
| `src/gas/slack_notifier.js` | **新增** | Slack API 封裝：`sendConfirmation()`、`sendReminder()`；Bot Token 管理（Script Properties） |
| `src/gas/weekly_reminder.js` | **新增** | Time-driven Trigger：週五 18:00 + 週一 08:00 推送任務摘要至 Slack DM |
| `src/gas/init_sheets.js` | **微調** | Action_Backlog 新增 `slack_notified`、`slack_notified_at`、`status` 欄位 |
| `src/nlu/system_prompt.md` | **修改** | 新增 Entity 匹配規則與 Grounding Context 格式說明 |

---

## 2. 前端狀態機與 Parsed Summary UI

### 狀態定義

```
INPUT → LOADING → PREVIEW ⇄ EDITING → CONFIRMING → RESULT
                    ↓                        ↓
                  (取消→INPUT)         (失敗→ERROR→可重試)
```

| 狀態 | 畫面 | 使用者可操作 |
|------|------|-------------|
| `INPUT` | 文字輸入框 + 送出按鈕 | 輸入文字、按「開始解析」 |
| `LOADING` | 輸入框鎖定 + spinner + 步驟進度 | 無（等待中） |
| `PREVIEW` | Parsed Summary 卡片（唯讀） | 「確認送出」「編輯」「取消」 |
| `EDITING` | Parsed Summary 卡片（欄位可編輯） | 修改欄位、「完成編輯」「取消」 |
| `CONFIRMING` | 卡片鎖定 + spinner | 無（寫入中） |
| `RESULT` | 成功摘要 + Slack 狀態 | 「繼續下一則」 |
| `ERROR` | 錯誤訊息 + 部分成功資訊 | 「重試 Slack」/「只保留 Sheets」/「回到首頁」 |

### Parsed Summary 卡片結構

卡片分為四個區塊，對應 NLU 輸出的四種 intent：

**1. Entity 區塊**（當 intents 含 `CREATE_ENTITY`）
- 欄位：`entity_name`、`category`（下拉：Client / Partner）、`industry`
- Disambiguation 警示：
  - confidence ≥ 0.80：自動綁定，顯示「✓ 已匹配：台積電 (E-0001)」灰色低調
  - confidence 0.50–0.79：黃色橫幅「⚠️ 疑似：台積電 (E-0001)，信心度 XX%」+ 「是，就是這個」/「不，建立新客戶」按鈕
  - confidence < 0.50：「🆕 新客戶」標籤，entity_name 可編輯

**2. Pipeline 區塊**（當 intents 含 `UPDATE_PIPELINE`）
- 欄位：`entity_name`（關聯上方）、`stage`（下拉：尋商/規格/提案/商議/贏單/輸單/暫緩）、`est_value`（數字輸入）、`next_action_date`（date picker）、`status_summary`（文字輸入）

**3. Interaction 區塊**（當 intents 含 `LOG_INTERACTION`）
- 欄位：`entity_name`、`ai_key_insights`（tag 形式，可刪除/新增）、`sentiment`（下拉：Positive / Neutral / Negative）
- `raw_transcript`：摺疊顯示原始文字（唯讀）

**4. Action 區塊**（當 intents 含 `SCHEDULE_ACTION`）
- 欄位：`entity_name`、`action_description`（文字）、`action_date`（date picker）、`action_time`（time picker，選填）
- 提示文字：「確認後將建立 Slack 提醒」

### NLU 降級 UX

- `overall_confidence < 50%`：整張卡片頂部紅色橫幅「⚠️ AI 解析信心不足，請確認以下資訊是否正確，或補充更多細節」
- `missing_fields` 非空：對應欄位標紅 +「此欄位 AI 無法解析，請手動填寫」
- 降級情況自動進入 `EDITING` 狀態（跳過 `PREVIEW`）

### 修改紀錄

使用者在 EDITING 中修改的欄位，前端記錄 `edit_log: [{ field, original, modified }]`，隨 `confirmWrite` 一起送出，寫入 Interaction_Timeline 的備註欄，供日後分析 NLU 精準度。

---

## 3. 後端 API 與資料流

### API Endpoints（透過 `google.script.run`）

**`parseOnly(rawText)`** — gemini_nlu.js

```
輸入：rawText (string)
處理：
  1. 從 Entity_Index sheet 讀取全量 entity 名單
  2. 將名單格式化後注入 system prompt 末尾：
     「## 現有客戶名單\n- E-0001 | 台積電 | Client | 半導體\n- E-0002 | ...」
  3. 呼叫 Gemini 2.5 Flash API
  4. 解析 JSON 回應
輸出：{ status: 'success', parsed_data: {...} } 或 { status: 'error', message: '...' }
```

**`confirmWrite(confirmedData)`** — dispatcher.js

```
輸入：{
  intents: [...],
  entities: [...],
  pipelines: [...],
  interactions: [...],
  actions: [...],
  edit_log: [...]
}
處理（Staged Commit 順序）：
  Step 1: Entity — 新建或跳過（依 intent）
  Step 2: Pipeline — 新建或更新（用 entity_id 精確匹配）
  Step 3: Interaction — 寫入 Timeline，附帶 edit_log
  Step 4: Action — 寫入 Backlog（slack_notified = false）
  Step 5: Slack 即時確認通知
輸出：{
  status: 'success' | 'partial_success' | 'error',
  result: { entities_created, pipelines_updated, interactions, tasks },
  slack_status: 'sent' | 'failed' | 'not_configured',
  failed_step: null | 'slack'
}
```

**`retrySlack(actionData)`** — dispatcher.js

```
輸入：{
  entity_name: '台積電',
  action_description: '準備競品比較表',
  action_date: '2026-04-14',
  pipelines: [{ stage, est_value, status_summary }]  // 用於 Slack 訊息內容
}
（前端從 confirmWrite 回應中暫存，不需重新查 Sheets）
處理：只重試 Slack 推送（呼叫 slack_notifier.sendConfirmation）
輸出：{ slack_status: 'sent' | 'failed' }
```

### Entity Matching 邏輯

1. **Gemini 負責 matching**：在 Grounding context 中提供 Entity_Index，Gemini 輸出 `matched_entity_id` + `entity_match_confidence`
2. **`confirmWrite` 用 entity_id 精確查找**：不再做 GAS 端字串比對
3. **新 Entity 流程**：`matched_entity_id` 為 null → 自動產生新 Entity_ID（沿用 `E-XXXX` 格式）

### Sheets CRUD

| Sheet | 操作 | 觸發條件 |
|-------|------|---------|
| Entity_Index | INSERT | `CREATE_ENTITY` 且使用者確認為新客戶 |
| Entity_Index | READ | `parseOnly` 時讀取全量名單做 Grounding |
| Strategic_Pipeline | INSERT | `UPDATE_PIPELINE` 且無既有 Pipeline_ID |
| Strategic_Pipeline | UPDATE | `UPDATE_PIPELINE` 且有既有 Pipeline_ID（依 entity_id 查找） |
| Interaction_Timeline | INSERT | `LOG_INTERACTION`（每次都是新增） |
| Action_Backlog | INSERT | `SCHEDULE_ACTION`（新增，含 `slack_notified: false`） |

---

## 4. Slack 整合

### Slack App 建立規格

**App 名稱：** Conversational CRM Bot

**所需 OAuth Scopes（Bot Token）：**
- `chat:write` — 發送訊息到 DM / 頻道
- `users:read` — 查詢使用者 ID
- `users:read.email` — 用 email 查找使用者

**不需要：** Event Subscriptions、Slash Commands（MVP 只發送，不接收）

**安裝方式：** 安裝到 workspace 後，將 Bot User OAuth Token 存入 GAS Script Properties（key: `SLACK_BOT_TOKEN`）

### slack_notifier.js 函式設計

**`sendConfirmation(actionData, slackUserId)`**
- 觸發時機：`confirmWrite` Step 5
- 訊息格式（Slack Block Kit）：

```
✅ CRM 已更新

📌 台積電 — 商議階段
   預估金額：NT$ 5,000,000
   摘要：客戶對報價有疑慮，需提供競品比較表

⏰ 下一步行動：2026-04-14
   準備競品比較表並安排第二次簡報
```

**`sendReminder(actionItems, slackUserId)`**
- 觸發時機：`weekly_reminder.js` 週五 / 週一批次
- 訊息格式：

```
📋 下週待辦預覽（04/13 — 04/19）

週一 04/13
  📌 台積電 — 準備競品比較表並安排第二次簡報
  📌 聯發科 — 寄送報價單

週三 04/15
  📌 鴻海 — 初次拜訪，帶 demo

共 3 筆行動項目
```

**`getSlackUserId(email)`**
- 用 `users.lookupByEmail` API 取得 Slack User ID
- 結果快取在 Script Properties
- MVP 只有一位使用者（小王），首次設定時存入即可

### weekly_reminder.js 設計

**兩個 Trigger：**

| 時間 | 內容 | 目的 |
|------|------|------|
| 週五 18:00（Asia/Taipei） | 下週一～日到期的所有 Action | 週末前預覽下週工作 |
| 週一 08:00（Asia/Taipei） | 本週一～日到期的所有 Action | 週一開工確認當週任務 |

**`sendWeeklyReminder(mode)` 邏輯：**
1. 依 `mode`（`'friday_preview'` / `'monday_confirm'`）計算日期範圍
2. 讀取 Action_Backlog，篩選 `action_date` 在範圍內且 `status != 'completed'`
3. 依日期分組、格式化訊息
4. 呼叫 `sendReminder()` 發送至 Slack DM
5. 若發送失敗，log 錯誤（不中斷，下次 trigger 會再撈到）

**Trigger 建立方式：**
```javascript
ScriptApp.newTrigger('sendFridayPreview').timeBased().onWeekDay(ScriptApp.WeekDay.FRIDAY).atHour(18).create();
ScriptApp.newTrigger('sendMondayConfirm').timeBased().onWeekDay(ScriptApp.WeekDay.MONDAY).atHour(8).create();
```

---

## 5. 資料欄位變更

### Action_Backlog 新增欄位

| 欄位 | 類型 | 說明 |
|------|------|------|
| `slack_notified` | Boolean | 即時確認是否已發送 |
| `slack_notified_at` | DateTime | 即時確認發送時間 |
| `status` | String | `pending` / `completed`（預設 pending） |

### Interaction_Timeline 新增欄位

| 欄位 | 類型 | 說明 |
|------|------|------|
| `edit_log` | String (JSON) | 使用者修改紀錄 `[{field, original, modified}]`，無修改則為 `[]` |

### Entity_Index — 無結構變更

---

## 6. NLU Grounding 與 Entity Disambiguation

### Grounding 注入方式

`parseOnly()` 執行時：
1. 讀取 Entity_Index 全部資料
2. 格式化為文字清單，附加在 system prompt 末尾：

```
## 現有客戶名單（Grounding Context）
以下是系統中已存在的客戶。若使用者提及的對象與以下名稱相符或高度相似，
請使用對應的 Entity_ID，並在 entity_match_confidence 中給出信心分數（0-1）。

- E-0001 | 台積電 | Client | 半導體
- E-0002 | 聯發科 | Client | IC 設計
- E-0003 | 日月光 | Partner | 封裝測試
```

3. 使用者訊息格式維持現有：`今天的日期：YYYY-MM-DD\n\n{rawText}`

### system_prompt.md 新增 Entity 匹配規則

```
## Entity 匹配規則
1. 若使用者提及的名稱與「現有客戶名單」中某筆完全相符或高度相似（如「台積」→「台積電」），
   設定 matched_entity_id 為該筆 Entity_ID，並給出 entity_match_confidence（0-1）。
2. 若信心度 < 0.5，設定 matched_entity_id 為 null，視為新客戶。
3. 若信心度介於 0.5-0.79，仍填入 matched_entity_id，但下游 UI 會要求使用者確認。
4. 一段回報中可能涉及多個 Entity，每個都需獨立匹配。
```

### Disambiguation UI 邏輯

| Confidence | UI 行為 |
|-----------|---------|
| ≥ 0.80 | 自動綁定，顯示「✓ 已匹配：台積電 (E-0001)」灰色低調 |
| 0.50 – 0.79 | 黃色警示橫幅 +「是，就是這個」/「不，建立新客戶」按鈕 |
| < 0.50 | 「🆕 新客戶」標籤，entity_name 預填 AI 猜測值，可編輯 |

---

## 7. 錯誤處理與 Edge Cases

### Staged Commit 流程

```
confirmWrite(confirmedData)
  │
  ├─ Step 1: Sheets 寫入
  │    ├─ 成功 → 繼續 Step 2
  │    └─ 失敗 → { status: 'error', failed_step: 'sheets' }
  │              前端：「❌ 資料寫入失敗」+ 重試按鈕
  │
  ├─ Step 2: Slack 即時通知
  │    ├─ 成功 → { status: 'success' }
  │    ├─ 未設定 → { status: 'success', slack_status: 'not_configured' }
  │    │            前端：成功 + 底部小字「Slack 尚未設定」
  │    └─ 失敗 → { status: 'partial_success', slack_status: 'failed' }
  │              前端：「✅ 資料已儲存」+「⚠️ Slack 通知失敗」
  │              按鈕：「重試 Slack」/「略過」
```

### Edge Cases

| 情境 | 處理方式 |
|------|---------|
| 使用者輸入空白或純符號 | 前端擋住，不呼叫 `parseOnly` |
| Gemini API 回傳非 JSON | `parseOnly` 回傳 error，前端顯示「AI 解析失敗，請重新描述」 |
| Gemini API timeout（> 30 秒） | GAS `UrlFetchApp` 設 30 秒 timeout，前端顯示「解析超時，請重試」 |
| NLU 回傳空 intents（`[]`） | 前端顯示「未偵測到可執行操作，請補充：對象、結果、下一步」，回到 INPUT |
| 使用者在 PREVIEW 修改 entity_name 為已存在客戶 | 前端不做即時驗證（MVP），以使用者輸入為準，Dispatcher 寫入時若 Entity_ID 衝突則 UPDATE |
| 一段文字涉及多個 Entity | NLU 輸出多筆，Parsed Summary 以多張卡片呈現，各自獨立編輯 |
| Action_Backlog 同一天有多筆 | 週報提醒中依日期分組顯示，不合併 |
| GAS 6 分鐘執行限制 | `parseOnly` 和 `confirmWrite` 是獨立呼叫，各自不太可能超時；`weekly_reminder` 若 Action 量大，分批處理（每 50 筆一 batch） |
| Slack Bot Token 未設定 | `confirmWrite` 回傳 `slack_status: 'not_configured'`，不阻擋 Sheets 寫入 |
| Slack Rate limit (429) | 等待 `retry_after` 秒後重試一次，仍失敗則回傳 failed |
