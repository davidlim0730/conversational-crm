# Product Requirements Document: Conversational CRM — The 3-Minute Ritual

**Author**: David Lin  
**Date**: 2026-04-07  
**Status**: Draft v2  
**Stakeholders**: BD 小王（主要使用者）、技術負責人、產品負責人  
**Supersedes**: `PRODUCT_PLAN.md` + `Product_Plan_Review.md`

---

## 1. Executive Summary

本產品讓第一線 BD 人員能在拜訪客戶後，透過一段自然語言「意識流回報」，在 3 分鐘內完成案件狀態更新與行程安排——無需手動填寫任何表單。核心技術為 Gemini 2.5 Flash NLU + Google Apps Script + Google Sheets，以最輕量的架構驗證「對話式 CRM 輸入」這個核心假設。MVP 的首要目標是建立使用者信任，不是最大化自動化程度。

---

## 2. Background & Context

### 問題根源

傳統 CRM（Salesforce、HubSpot）的核心矛盾：資料對管理層有價值，但輸入成本由 BD 自己承擔。研究顯示 BD 花費 17–23% 工時在行政資料錄入，而非實際業務拓展。其結果是：要嘛資料不全、要嘛 BD 因行政負擔流失。

### 現有方案回顧（v1 Product Plan 的侷限）

| 問題 | v1 現況 | 嚴重程度 |
|------|---------|---------|
| NLU 解析失敗無降級 | 假設解析永遠成功 | 🔴 Critical |
| 編輯流程未定義 | 只有「復原/編輯」概念 | 🔴 Critical |
| Mobile UX 未提及 | 桌面優先設計 | 🔴 Critical |
| Entity 歧義處理缺失 | 依賴 AI 自行判斷 | 🟠 High |
| 操作原子性未定義 | GCal 失敗時 Sheets 已寫入 | 🟠 High |
| GAS Fuzzy Matching 擴展性差 | 硬編碼字串比對 | 🟡 Medium |
| 成功指標主觀 | 「顯著優於手動」 | 🟡 Medium |

### 已決策事項（承接自 Product_Plan_Review.md）

1. **採用 Parsed Summary 確認模式**：AI 解析後，先給使用者預覽，確認後才寫入。
2. **量化目標**：單次登錄時間 < 3 分鐘。
3. **廢棄 GAS Fuzzy Matching**：改由 Gemini Grounding（將現有客戶名單作為 Context）進行 Entity 綁定。
4. **安全合規**：列入 Backlog，不在 MVP 範圍。

---

## 3. Objectives & Success Metrics

### Goals

1. BD 完成一次「意識流輸入 → 確認 → 寫入」的完整流程時間 < 3 分鐘。
2. 解析結果的使用者接受率（不修改直接確認）> 70%（代表 NLU 精準度足夠實用）。
3. 使用者對已儲存資料有完整的查看與修正能力（零黑箱）。

### Non-Goals（MVP 明確排除）

| 非目標 | 排除原因 |
|--------|---------|
| 多人協作 / 資料共享 | Phase 2 才處理，現在過度設計 |
| 向量搜尋 / 語意檢索 | 需要資料量累積，Phase 3 |
| 企業級安全合規 | Backlog，B2B SaaS 時再做 |
| 主管 BI Dashboard | 非核心使用者，Phase 3 |
| 語音輸入 | 增加 MVP 複雜度，後續迭代 |
| Native App（iOS/Android） | Web App 先行驗證假設 |

### Success Metrics

| 指標 | 目前基準 | MVP 目標 | 量測方式 |
|------|---------|---------|---------|
| 單次登錄時間 | ~15 分鐘（手動 Sheets） | < 3 分鐘 | 使用者計時自回報 |
| NLU 解析接受率 | N/A | > 70% | 記錄「直接確認」vs「修改後確認」比率 |
| 每日更新率 (Logging Rate) | ~20%（估計） | > 60% | Sheets 寫入次數 / 工作日 |
| Pipeline 具備 Next_Action_Date 比例 | < 30%（估計） | > 80% | Sheets 欄位完整率計算 |

---

## 4. Target Users & Segments

### Primary User: BD 小王

- **角色**：資深業務開發，管理 20–50 個活躍案件
- **行為模式**：一天 2–4 次客戶拜訪，傍晚或通勤時進行回顧
- **痛點**：記憶力有限，拜訪細節容易在睡前遺忘；打開 Sheets 填表的心理門檻高
- **裝置**：主要使用手機（iPhone/Android），偶爾用筆電
- **技術熟悉度**：不排斥 AI，但對「系統搞錯我的資料」有高度敏感

### Out of Scope Users（MVP）

- 業務主管（想看 Dashboard）
- 其他 BD 同仁（多人協作）
- 客戶端聯絡人

---

## 5. User Stories & Requirements

### P0 — Must Have

| # | User Story | Acceptance Criteria |
|---|-----------|-------------------|
| P0-1 | 身為 BD，我要能在手機上輸入一段自由格式的文字描述今天的拜訪 | 輸入框支援至少 1000 字；在 iOS Safari / Android Chrome 上正常顯示鍵盤且不跳版 |
| P0-2 | 身為 BD，我要在送出前看到 AI 解析結果的預覽（Parsed Summary），確認無誤後才寫入系統 | 顯示：Entity 名稱、案件階段、金額、下次行動日期、AI 摘要；有「確認送出」和「取消」兩個按鈕 |
| P0-3 | 身為 BD，我要能在 Parsed Summary 裡修改 AI 判斷錯誤的欄位，再確認送出 | 所有解析欄位均可點擊修改；修改後即時更新預覽；修改紀錄記入 log |
| P0-4 | 身為 BD，當我描述一個「新客戶/夥伴」，系統要建立新 Entity；當我描述「既有客戶」，系統要更新既有 Entity | AI 以 Grounding（注入現有客戶名單）進行 Entity 綁定；綁定信心度 < 80% 時，主動在 Parsed Summary 顯示「⚠️ 疑似新客戶，確認是否為 [候選名稱]？」 |
| P0-5 | 身為 BD，當操作失敗（Sheets 或 Calendar 寫入錯誤），我要知道哪個步驟失敗，且不會出現資料只寫一半的狀態 | 採用 staged commit：先寫 Sheets，成功後再建 GCal；GCal 失敗時顯示錯誤並提供「只保留 Sheets 記錄」或「重試 GCal」選項 |

### P1 — Should Have

| # | User Story | Acceptance Criteria |
|---|-----------|-------------------|
| P1-1 | 身為 BD，我要能在事後查看最近 N 筆 Interaction log，確認系統真的記錄了正確的東西 | 提供 read-only 的 Log 檢視頁，顯示最近 10 筆，包含 Raw_Transcript 和 AI_Key_Insights |
| P1-2 | 身為 BD，當 AI 完全無法解析我的輸入（如：「今天還好」），系統要提示我補充資訊，而非靜默失敗 | NLU 置信度整體 < 50% 時，回傳「⚠️ 無法解析足夠資訊，請補充：對象、結果、下一步」的 inline 提示 |
| P1-3 | 身為 BD，我要能在 Parsed Summary 明確看到「這筆資料會更新哪個案件」或「這是新案件建立」，而非模糊的 AI 猜測 | Parsed Summary 顯示 Intent（UPDATE_PIPELINE / CREATE_ENTITY / LOG_INTERACTION / SCHEDULE_ACTION）及對應的目標 Project_ID（如有） |

### P2 — Nice to Have / Future

| # | User Story | Acceptance Criteria |
|---|-----------|-------------------|
| P2-1 | 身為 BD，我想用語音輸入來代替打字 | 整合 Web Speech API 或第三方 STT（Phase 2） |
| P2-2 | 身為 BD，我要能看到跨案件的 Next_Action_Date 行事曆彙整 | 整合 Google Calendar 讀取（Phase 2） |
| P2-3 | 身為主管，我想看所有案件的 Pipeline 總覽 | BI Dashboard（Phase 3） |

---

## 6. Solution Overview

### 架構決策

```
[Mobile Web UI (GAS doGet)]
    │
    ├── 1. 使用者輸入意識流文字
    │
    ▼
[Gemini 2.5 Flash — Parser Agent]
    │  Context Grounding: 注入 Entity_Index 現有名單
    │  輸出: Structured JSON (intent, entities, confidence scores)
    │
    ▼
[Parsed Summary Preview UI]
    │  使用者確認 / 修改
    │
    ▼
[GAS Dispatcher]
    ├── Sheets CRUD (Entity_Index / Strategic_Pipeline / Interaction_Timeline / Action_Backlog)
    └── Google Calendar API (建立 action event，回填 GCal_Link)
```

### 關鍵設計決策

**決策 1：Staged Commit（非 All-or-Nothing）**
GCal 建立失敗不回滾 Sheets，而是紀錄 GCal 為 `pending`，並讓使用者選擇。理由：Sheets 記錄是核心資產，GCal 是附加價值；犧牲 GCal 比犧牲整筆記錄更合理。

**決策 2：Entity Disambiguation by Confidence Threshold**
Gemini Grounding 對 Entity 綁定輸出 `entity_match_confidence`：
- ≥ 80%：自動綁定，在 Parsed Summary 低調顯示
- 50–79%：Parsed Summary 顯示黃色警示，要求使用者確認
- < 50%：預設為「新 Entity」，要求使用者命名

**決策 3：Mobile-First Web UI**
- 單欄垂直佈局，適配 375px+ 螢幕
- 輸入框佔螢幕 40%，Parsed Summary 以卡片形式展開
- 確認/取消按鈕固定在底部（thumb zone）

**決策 4：NLU 降級 UX**
置信度不足時不靜默失敗，提供明確的「缺什麼」提示，引導使用者補充最少必要資訊。

### NLU JSON 輸出規格（更新版）

```json
{
  "intent": "UPDATE_PIPELINE | CREATE_ENTITY | LOG_INTERACTION | SCHEDULE_ACTION",
  "entity_name": "台積電",
  "entity_match_confidence": 0.95,
  "matched_entity_id": "E-0001",
  "stage": "商議",
  "est_value": 3000000,
  "currency": "TWD",
  "next_action_date": "2026-04-14",
  "status_summary": "客戶對報價有疑慮，需提供競品比較表",
  "key_insights": ["報價疑慮", "競品比較需求", "決策者為採購長"],
  "sentiment": "Neutral",
  "raw_transcript": "...",
  "overall_confidence": 0.87,
  "missing_fields": []
}
```

---

## 7. Open Questions

| 問題 | Owner | Deadline | 備注 |
|------|-------|----------|------|
| GAS 執行時間限制（6 min/execution）是否會在複雜 NLU + Sheets + GCal 三步驟下超時？ | Tech Lead | 實作前 | 需做 benchmark；若超時考慮 async pattern |
| 「確認送出」後的 UX 動線：停在同一頁 or 跳回首頁？ | Product + BD 小王 | 第一輪 user testing | 影響 habit formation |
| Gemini 2.5 Flash API 在 GAS 環境的 latency 是否能達到 < 5 秒讓使用者等待？ | Tech Lead | PoC 時驗證 | 超過 5 秒需加 loading state |
| Parsed Summary 的「編輯」模式要做 inline edit 還是跳轉至 form？ | Product | Sprint 1 設計確認前 | Inline 更快但實作複雜 |

---

## 8. Timeline & Phasing

### Phase 1: MVP（當前）

**Sprint 1（基礎建設）**
- [x] `init_sheets.js`：自動化建立資料庫結構
- [x] Gemini NLU System Prompt 設計
- [x] GAS Web App 骨架 + doGet/doPost

**Sprint 2（核心流程）**
- [ ] NLU Grounding：從 Sheets 讀取 Entity_Index 注入 Gemini Context
- [ ] Parsed Summary UI（Mobile-First）：顯示解析結果、支援欄位 inline 修改
- [ ] Entity Disambiguation 邏輯（confidence threshold 實作）

**Sprint 3（Dispatcher + 完整流程）**
- [ ] GAS Dispatcher：Sheets CRUD（4 張表）
- [ ] Google Calendar API 整合
- [ ] Staged Commit 錯誤處理
- [ ] NLU 置信度降級 UX

**Sprint 4（打磨與驗證）**
- [ ] End-to-end latency 測試（目標 < 5 秒 NLU response）
- [ ] Mobile 裝置測試（iOS Safari / Android Chrome）
- [ ] 與 BD 小王進行 5 輪 user testing，量測登錄時間
- [ ] KPI 基準建立（解析接受率、登錄時間）

### Phase 2: 多人協作（後續規劃）
- 架構遷移：Sheets → Supabase / PostgreSQL
- Entity 結構重構：Account + Contact 分離
- 多使用者權限與資料隔離

### Phase 3: 資料智能（更後續）
- 向量搜尋（Vertex AI Embeddings）
- AI Insight 自動生成
- 主管 BI Dashboard

---

## Appendix A: 資料庫 Schema

#### 表 1: Entity_Index（客戶/夥伴名錄）
| 欄位名 | 類型 | 說明 |
| :--- | :--- | :--- |
| Entity_ID | String | 主鍵（格式: E-0001） |
| Name | String | 唯一名稱（用於 Grounding 比對） |
| Category | Enum | Client / Partner |
| Industry | String | 產業類別 |
| Created_At | DateTime | 建立日期 |

#### 表 2: Strategic_Pipeline（案件主表）
| 欄位名 | 類型 | 說明 |
| :--- | :--- | :--- |
| Project_ID | String | 主鍵（格式: P-2025-0001） |
| Entity_Name | String | 關聯 Entity_Index.Name |
| Stage | Enum | 尋商 / 規格 / 提案 / 商議 / 贏單 / 輸單 / 暫緩 |
| Est_Value | Number | 預估金額（幣別統一，預設 TWD） |
| Next_Action_Date | Date | 下次跟進日期 |
| Status_Summary | String | AI 生成的一句話現況 |

#### 表 3: Interaction_Timeline（互動日誌表）
| 欄位名 | 類型 | 說明 |
| :--- | :--- | :--- |
| Log_ID | String | 主鍵（格式: L-XXXXX） |
| Timestamp | DateTime | 系統寫入時間 |
| Entity_Name | String | 關聯對象 |
| Raw_Transcript | Text | 儲存原始文字（供向量搜尋預備） |
| AI_Key_Insights | Text | 3 個關鍵點（Bullet points） |
| Sentiment | Enum | Positive / Neutral / Negative |

#### 表 4: Action_Backlog（待辦與同步）
| 欄位名 | 類型 | 說明 |
| :--- | :--- | :--- |
| Task_ID | String | 主鍵 |
| Ref_Entity | String | 關聯對象 |
| Task_Detail | String | 任務描述 |
| Due_Date | DateTime | 預定執行時間 |
| GCal_Link | URL | Google 日曆行程連結（Staged Commit 後填入） |

---

## Appendix B: 開發進度（截至 2026-04-07）

### Phase 1: Foundation
- [x] 初始化 Git 版本控制
- [x] 撰寫 `init_sheets.js` 自動化建立資料庫結構（含進階驗證與 ID 生成）

### Phase 2: Intelligence (NLU)
- [x] 設計 Gemini 2.5 Flash System Prompt
- [x] 實作 Intent Routing（CREATE_ENTITY, UPDATE_PIPELINE, LOG_INTERACTION, SCHEDULE_ACTION）
- [x] 實作 Entity Extraction 初版測試

### Phase 3: Automation (GAS Dispatcher)
- [x] 實作 GAS Web App 接收 JSON
- [x] 串接 Google Calendar API 初版

### Phase 4: Interface & Integration（進行中）
- [x] 建立極簡文字輸入 Web 介面（內嵌於 GAS doGet）
- [ ] NLU Grounding（Entity_Index 名單注入 Gemini Context）
- [ ] Parsed Summary UI（Mobile-First，含 inline 編輯）
- [ ] Entity Disambiguation 邏輯（confidence threshold）
- [ ] Staged Commit 錯誤處理
- [ ] NLU 置信度降級 UX
- [ ] End-to-end 流暢度測試與優化

---

## Appendix C: 與 v1 的關鍵差異對照

| 維度 | v1 (PRODUCT_PLAN.md) | v2 (本文件) |
|------|---------------------|------------|
| NLU 失敗處理 | 未定義 | confidence threshold + inline 提示 |
| 編輯流程 | 「復原/編輯」概念 | Inline edit in Parsed Summary，明確 AC |
| Mobile | 未提及 | Mobile-First，375px+，thumb zone CTA |
| Entity 歧義 | GAS Fuzzy Matching | Gemini Grounding + confidence score |
| 操作原子性 | 未定義 | Staged commit，明確 partial failure UX |
| 成功指標 | 「顯著優於手動」 | 4 個量化 KPI，含基準值與目標值 |
