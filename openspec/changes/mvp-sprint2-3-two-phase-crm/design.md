## Context

現有系統（Architecture A）：GAS Web App → `processRawText()` → Gemini NLU → 直接寫入 Sheets + GCal。前端為單頁輸入框，無預覽，使用者無法在確認前修正 AI 解析結果。

**主要問題：**
1. AI 解析錯誤靜默寫入（如日期推算錯誤、Entity 對應到錯誤客戶）
2. GCal 整合維護成本高，BD 使用者偏好 Slack 通知
3. 無 Entity Grounding：同一客戶可能以不同名稱重複建立

**技術約束：**
- GAS 執行時間上限 6 分鐘（單次 Gemini 呼叫約 2–5 秒）
- 無本地測試環境，邏輯驗證需在 GAS 編輯器執行
- `clasp push` 部署，`src/gas/` 為 rootDir
- Sheets 為唯一持久層，無獨立資料庫

## Goals / Non-Goals

**Goals:**
- 引入兩階段流程（parseOnly → confirmWrite），使用者可預覽並修改解析結果再寫入
- 以 Slack Bot 取代 GCal，提供即時確認通知與每週待辦提醒
- 實作 Entity Grounding：Gemini 輸出 `matched_entity_id` + `entity_match_confidence`
- 前端重構為 SPA 狀態機，提供完整的解析預覽與 Disambiguation UX
- 記錄使用者修改（edit_log）至 Interaction_Timeline

**Non-Goals:**
- Architecture C 遷移（標準後端 + Google APIs 直連）：下一階段
- RAG/向量搜尋 Entity Grounding（Phase 5）：本次只做關鍵字注入
- 多使用者支援：目前只支援單一 BD（小王）
- 離線模式或行動裝置最佳化

## Decisions

### D1：兩階段 API 拆分方式
**決策：** `parseOnly()` 與 `confirmWrite()` 為獨立的 GAS 函式，由 `doPost()` 依 `action` 欄位路由。

**理由：** GAS 無法做 WebSocket 或 Server-Sent Events，只能 HTTP 請求。拆分為兩次請求符合現有 `doPost` 路由模式，且讓前端狀態機清晰對應每個請求。

**替代方案考慮：** 單一請求帶 `isDryRun` 參數 → 被拒，語意不清，且難以在 confirmWrite 傳回使用者修改後的資料。

### D2：Entity Grounding 方式
**決策：** `parseOnly()` 呼叫前，先從 Entity_Index sheet 讀取所有 Entity（最多 200 筆），以純文字清單形式附加在 Gemini system prompt 末尾。

**理由：** 實作最簡單，無需向量 DB 或嵌入模型，對現有 Entity 數量（預期 <100）效果足夠。Gemini 2.5 Flash context window 夠大，不會有 token 限制問題。

**替代方案考慮：** 向量相似度搜尋（Phase 5 路線）→ 功能更強但依賴外部服務，超出 MVP 範疇。

### D3：Slack vs GCal
**決策：** 完全移除 GCal 整合，改用 Slack Bot（`chat:write` + `users:read.email` scopes）。`slack_notifier.js` 封裝所有 Slack API 呼叫。

**理由：** BD 使用者（小王）日常在 Slack 工作，通知更即時；GCal 整合需要 OAuth 授權流程，維護複雜；Slack Webhook 或 Bot Token 設定一次即可。

**替代方案考慮：** Email 通知 → 太慢、通知疲勞；保留 GCal + 新增 Slack → 維護兩套整合，超出 MVP 成本。

### D4：前端狀態機實作
**決策：** 純 JavaScript（無框架），以 `appState` 物件 + `setState(newState)` 函式管理，CSS class `active` 控制面板顯示。

**理由：** GAS `frontend.html` 為單一檔案，無法引入 npm 套件；純 JS 狀態機夠用，且避免引入 React/Vue 的 GAS 環境相容性問題。

**狀態轉移：**
```
INPUT → (submit) → LOADING → (parseOnly 成功) → PREVIEW
PREVIEW → (使用者點「修改」) → EDITING → (完成) → PREVIEW
PREVIEW → (使用者點「確認寫入」) → CONFIRMING → (confirmWrite 成功) → RESULT
                                                → (失敗) → ERROR
LOADING / CONFIRMING → (API 錯誤) → ERROR
ERROR → (重試/返回) → INPUT
```

### D5：Slack 通知失敗處理策略
**決策：** Sheets 寫入成功後，Slack 失敗不 rollback，回傳 `partial_success`；前端顯示「已寫入，Slack 通知失敗」提示，並提供「重試通知」按鈕，呼叫 `retrySlack()`。

**理由：** Sheets 寫入為主要業務邏輯，Slack 為輔助通知，不應因通知失敗導致資料遺失或使用者重複輸入。

### D6：edit_log 格式
**決策：** `[{field: string, original: any, modified: any}]` JSON 字串，寫入 Interaction_Timeline 第 8 欄（Edit_Log）。

**理由：** 格式簡單，便於日後稽核；JSON 字串存 Sheets 已是現有 `ai_key_insights` 的做法。

## Risks / Trade-offs

| 風險 | 緩解策略 |
|------|---------|
| Gemini 回傳非 JSON 格式（prompt injection 或 hallucination） | `gemini_nlu.js` 加 try/catch + JSON.parse 防護，失敗時回傳 `{error: 'parse_failed'}` |
| Slack Bot Token 外洩 | 存於 GAS Script Properties（非程式碼），不 commit |
| Entity_Index 超過 200 筆時 Grounding prompt 過長 | 目前 MVP 不處理，Phase 5 改為 RAG；現在記錄為已知限制 |
| `initSheetStructure()` 破壞性執行（清除現有資料） | 文件警告 + 程式碼確認 Alert；生產環境需先備份 |
| 前端 SPA 在 GAS iframe 環境的 CSP 限制 | 沿用現有 `frontend.html` 已驗證的 inline script 模式 |
| 每週 Reminder Trigger 在 GAS 免費版有配額限制 | 每週 2 次觸發（週五/週一），遠低於配額 |

## Migration Plan

1. **備份 Sheets 資料**（使用者自行操作）
2. `clasp push` 部署所有新檔案
3. 在 GAS Script Properties 設定 `SLACK_BOT_TOKEN`、`USER_EMAIL`
4. 在 GAS 編輯器執行 `initSheetStructure()`（會清除並重建欄位）
5. 執行 `setupWeeklyTriggers()` 設定週期觸發器
6. 在 GAS 部署介面重新發布 Web App（版本號遞增）
7. 驗證：執行 `testParseOnly()`、`testConfirmWrite()`、`testSlackNotifier()` 確認各模組正常

**Rollback：** 舊版程式碼在 git history 中，`git checkout <old-commit> -- src/gas/` + `clasp push` 可回滾；Sheets 欄位需手動修復（從備份還原）。

## Open Questions

- Slack Bot 需要加入哪個 Workspace Channel？（目前設計為 DM 給使用者，無需 Channel 設定）
- Entity_Index 未來超過 200 筆的時間點？（決定 Phase 5 優先級的依據）
