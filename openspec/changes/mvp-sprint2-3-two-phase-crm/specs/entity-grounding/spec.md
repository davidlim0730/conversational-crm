## ADDED Requirements

### Requirement: 動態注入 Entity 名單至 Gemini Prompt
系統 SHALL 在每次呼叫 `parseOnly()` 前，從 Entity_Index sheet 讀取所有 Entity（最多 200 筆），以純文字清單格式附加於 Gemini system prompt 末尾，作為 Grounding Context。

#### Scenario: Entity_Index 有資料
- **WHEN** Entity_Index 中有 N 筆記錄（N ≤ 200）
- **THEN** System prompt 末尾附加格式為 `## 現有客戶名單（Grounding Context）\n- E-XXXX | 名稱 | Category | Industry` 的清單

#### Scenario: Entity_Index 為空
- **WHEN** Entity_Index 中沒有任何資料列
- **THEN** System prompt 末尾附加空的 Grounding Context 區塊，不影響解析

#### Scenario: Entity 超過 200 筆
- **WHEN** Entity_Index 超過 200 筆記錄
- **THEN** 只取前 200 筆注入，並在 Grounding Context 末尾加注「（已截斷至前 200 筆）」

### Requirement: NLU 輸出 matched_entity_id 與 entity_match_confidence
系統 SHALL 要求 Gemini 在解析 entities 時，輸出 `matched_entity_id`（比對到的 Entity_ID 或 null）與 `entity_match_confidence`（0–1 信心分數）。

#### Scenario: 高信心匹配（≥ 0.80）
- **WHEN** Gemini 判斷使用者提及的名稱與 Grounding Context 中某筆高度相符（confidence ≥ 0.80）
- **THEN** `matched_entity_id` 為對應的 Entity_ID，`entity_match_confidence` ≥ 0.80

#### Scenario: 中信心匹配（0.50–0.79）
- **WHEN** Gemini 判斷相似但不確定（confidence 0.50–0.79）
- **THEN** `matched_entity_id` 填入最可能的 Entity_ID，`entity_match_confidence` 在 0.50–0.79 之間

#### Scenario: 低信心或找不到（< 0.50）
- **WHEN** Gemini 找不到相符記錄或信心 < 0.50
- **THEN** `matched_entity_id` 為 `null`，`entity_match_confidence` < 0.50

#### Scenario: 未提供 Grounding Context
- **WHEN** Grounding Context 為空（Entity_Index 無資料）
- **THEN** 所有 entities 的 `matched_entity_id` 為 `null`，`entity_match_confidence` 為 `0`

### Requirement: NLU 輸出 overall_confidence 與 missing_fields
系統 SHALL 要求 Gemini 輸出 `overall_confidence`（整體解析信心分數，0–1）與 `missing_fields`（無法解析、需使用者補填的欄位名稱陣列）。

#### Scenario: 輸入完整清晰
- **WHEN** 輸入文字包含足夠資訊供完整解析
- **THEN** `overall_confidence` ≥ 0.80，`missing_fields` 為空陣列 `[]`

#### Scenario: 輸入有缺漏
- **WHEN** 輸入文字缺少關鍵欄位（如日期、金額）
- **THEN** `missing_fields` 列出無法解析的欄位名稱（如 `["action_date", "est_value"]`）

### Requirement: NLU JSON 使用 actions 格式（取代舊版 tasks）
系統 SHALL 使用更新後的 NLU JSON 格式：`actions[]` 陣列取代舊版 `tasks[]`；欄位名稱：`entity_name`（取代 `ref_entity`）、`action_description`（取代 `task_detail`）、`action_date`（取代 `due_date`）。

#### Scenario: SCHEDULE_ACTION 意圖被觸發
- **WHEN** Gemini 解析到需安排任務的意圖
- **THEN** NLU JSON 包含 `actions` 陣列，每個物件含 `entity_name`、`action_description`、`action_date`

#### Scenario: 舊版 tasks 格式不再使用
- **WHEN** 系統呼叫 NLU
- **THEN** 回傳 JSON 中不含 `tasks` 欄位
