# Product Documentation: Conversational CRM (The 3-Minute Ritual)

## 1. 產品願景 (Product Vision)
透過「意識流」文字輸入，讓 BD 人員（小王）在拜訪客戶後的空檔，能以最自然的語言完成 CRM 資料結構化更新與行程安排，消除進入系統填寫表單的行政負擔。

---

## 2. 產品需求文件 (PRD)

### 2.1 核心使用者故事
**角色**：資深 BD 小王
**場景**：傍晚回家沙發上，進行今日拜訪回顧。
**行為**：輸入一段約 3 分鐘的「意識流回報」。
**價值**：自動更新案件狀態、建立日曆提醒、關聯合作夥伴，完全無須手動操作試算表。

### 2.2 功能範圍 (Scope)
- **NLU 解析**：提取實體（Entity）、預估金額、目前階段、下次行動日期。
- **意圖路由**：自動判斷是「新對象建立」、「既有案件更新」還是「純紀錄」。
- **自動化執行**：
    - 更新 Google Sheets 資料庫。
    - 串接 Google Calendar 建立事件。
    - 回貼 GCal 連結至資料庫以便追蹤。

---

## 3. 技術規格 (Technical Spec)

### 3.1 系統架構
本系統採用 **Agentic Workflow**：
- **Parser Agent (Gemini 2.5 Flash)**: 負責文字解析與轉 JSON。
- **Dispatcher Agent (GAS)**: 負責執行具體的 CRUD 與 API 調用。
- **Storage**: 以 Google Sheets 作為持久層。

### 3.2 資料庫規格 (Database Schema)

#### 表 1: Entity_Index (客戶/夥伴名錄)
| 欄位名 | 類型 | 說明 |
| :--- | :--- | :--- |
| Entity_ID | String | 主鍵 (格式: E-0001) |
| Name | String | 唯一名稱 (用於索引/Fuzzy Matching) |
| Category | Enum | Client / Partner |
| Industry | String | 產業類別 |
| Created_At | DateTime | 建立日期 |

#### 表 2: Strategic_Pipeline (案件主表)
| 欄位名 | 類型 | 說明 |
| :--- | :--- | :--- |
| Project_ID | String | 主鍵 (格式: P-2025-0001) |
| Entity_Name | String | 關聯 Entity_Index.Name |
| Stage | Enum | 探索 / 提案 / 商議 / 贏單 / 輸單 / 觀察 |
| Est_Value | Number | 預估金額 (幣別統一) |
| Next_Action_Date | Date | 下次跟進日期 |
| Status_Summary | String | AI 生成的一句話現況 |

#### 表 3: Interaction_Timeline (互動日誌表)
| 欄位名 | 類型 | 說明 |
| :--- | :--- | :--- |
| Log_ID | String | 主鍵 (L-XXXXX) |
| Timestamp | DateTime | 系統寫入時間 |
| Entity_Name | String | 關聯對象 |
| Raw_Transcript | Text | 儲存原始文字 (供向量搜尋預備) |
| AI_Key_Insights | Text | 3 個關鍵點 (Bullet points) |
| Sentiment | Enum | Positive / Neutral / Negative |

#### 表 4: Action_Backlog (待辦與同步)
| 欄位名 | 類型 | 說明 |
| :--- | :--- | :--- |
| Task_ID | String | 主鍵 |
| Ref_Entity | String | 關聯對象 |
| Task_Detail | String | 任務描述 |
| Due_Date | DateTime | 預定執行時間 |
| GCal_Link | URL | Google 日曆行程連結 |

---

## 4. 開發路線圖 (Roadmap)

### Phase 1: Foundation (Current)
- [x] 初始化 Git 版本控制。
- [ ] **Next**: 撰寫 `init_sheets.js` 自動化建立資料庫結構。

### Phase 2: Intelligence (NLU)
- [ ] 設計 Gemini 2.5 Flash System Prompt。
- [ ] 實作 Intent Routing (CREATE_ENTITY, UPDATE_PIPELINE, LOG_INTERACTION)。
- [ ] 實作 Entity Extraction 測試。

### Phase 3: Automation (GAS Dispatcher)
- [ ] 實作 GAS Web App 接收 JSON。
- [ ] 實作 Fuzzy Matching 客戶名稱。
- [ ] 串接 Google Calendar API。

### Phase 4: Interface & Integration
- [ ] 建立極簡文字輸入 Web 介面。
- [ ] 端對端流暢度測試與優化 (Latency & Accuracy)。
