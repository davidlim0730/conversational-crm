# 合併版 Dispatcher 實作計劃

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 將 `src/gas/dispatcher.js` 改寫為合併版，保留舊版兩階段流程（parseOnly→confirmWrite→retrySlack）與 Slack 通知，同時引入新 v2 schema（9 張表）、Stage_Changed_Events 自動記錄、doGet RESTful API、以及通用 CRUD helpers。

**Architecture:** 以舊版 `src/gas/dispatcher.js` 的兩階段流程（parseOnly / confirmWrite / retrySlack）為骨架，全面替換 Schema 引用：Entity_Index → Customers（或 Partners_Sheet）、Strategic_Pipeline → Deal_Matrix、Interaction_Timeline → Interactions。NLU 輸出格式不變，仍使用 `intents[]` + `entities/pipelines/interactions/actions` 陣列。從 v2 dispatcher 移植：通用 CRUD helpers（addRow_ / updateRow_ / deleteRow_）、logStageChangeEvent_、doGet RESTful routing（getSheetData_ 為基礎）。

**Tech Stack:** Google Apps Script (V8 runtime)、Google Sheets API、Slack Incoming Webhook、Gemini API（透過現有 `gemini_nlu.js` 的 `parseOnly()` 呼叫）

---

## 前置知識

### 表格欄位對照（精確順序，與 init_sheets.js SCHEMA 一致）

| 表格 | 欄位（依序） |
|---|---|
| Customers | Customer_ID, Company_Name, Industry, Key_Contact, Lead_Source, Status, Reporter, Created_At |
| Partners_Sheet | Partner_ID, Partner_Name, Partner_Type, Tier, Status, Reporter, Created_At |
| Deal_Matrix | Deal_ID, Customer_ID, Product_ID, Partner_ID, Partner_Role, Stage, is_pending, Est_Value, Deal_Value, Next_Follow_Up, Status_Summary, Owner, Last_Updated_By |
| Interactions | Interaction_ID, Timestamp, Sales_Rep, Customer_ID, Product_ID, Partner_ID, Raw_Notes, AI_Key_Insights, Extracted_Intent, Sentiment, Is_Human_Corrected, Edit_Log |
| Stage_Changed_Events | Event_ID, Deal_ID, From_Stage, To_Stage, Change_Reason, Updated_By, Timestamp |
| Action_Backlog | Task_ID, Ref_Entity, Task_Detail, Due_Date, Reporter, Slack_Notified, Slack_Notified_At, Status |
| Eval_Feedback_Sheet | Feedback_ID, Interaction_ID, Product_ID, Original_Raw_Note, AI_Suggested_Stage, Human_Corrected_Stage, Feedback_Timestamp |
| Product_Lines | Product_ID, Name, Product_Owner, USP, Status, Target_Segments |

### NLU 輸出格式（system_prompt.md v2.0，不變）

```json
{
  "intents": ["CREATE_ENTITY", "UPDATE_PIPELINE", "LOG_INTERACTION", "SCHEDULE_ACTION"],
  "overall_confidence": 0.88,
  "missing_fields": [],
  "entities": [
    { "name": "公司名", "category": "Client", "industry": "產業", "matched_entity_id": null, "entity_match_confidence": 0 }
  ],
  "pipelines": [
    { "entity_name": "公司名", "stage": "2", "is_pending": false, "product_id": "P-001", "est_value": 500000, "next_action_date": "2026-04-20", "status_summary": "摘要" }
  ],
  "interactions": [
    { "entity_name": "公司名", "raw_transcript": "原文", "ai_key_insights": ["重點1", "重點2", "重點3"], "sentiment": "Positive" }
  ],
  "actions": [
    { "entity_name": "公司名", "task_detail": "任務描述", "due_date": "2026-04-20" }
  ]
}
```

### ID 函式（來自 init_sheets.js，直接呼叫）

- `getNextCustomerId()` → 新客戶
- `getNextPartnerId()` → 新夥伴
- `getNextDealId()` → 新案件
- `getNextInteractionId()` → 新互動紀錄
- `getNextEventId()` → 新階段事件
- `getNextTaskId()` → 新任務
- `getNextFeedbackId()` → 新 HITL 反饋

### 現有函式（其他 GAS 檔案，直接引用）

- `parseOnly(rawText)` → 在 `gemini_nlu.js` 中定義，呼叫 Gemini API，回傳 NLU JSON
- `sendConfirmation(actionData)` → 現有 Slack 通知函式，`actionData` 格式：`{ task_id, entity_name, task_detail, due_date }`

---

## 檔案結構

| 動作 | 路徑 | 職責 |
|---|---|---|
| **改寫** | `src/gas/dispatcher.js` | 合併版主 dispatcher（本計劃唯一修改目標） |
| 參考 | `src/gas/init_sheets.js` | SCHEMA 欄位順序 + ID 函式 |
| 參考 | `src/gas/gemini_nlu.js` | `parseOnly()` 介面 |
| 參考 | `product-owner-management/gas-api/dispatcher.js` | CRUD helpers + new handlers 來源 |
| 參考 | `product-owner-management/MERGED_SCHEMA.md` | 欄位定義權威來源 |

---

## Task 1：檔案骨架 + doGet 雙模路由 + 基礎工具

**Files:**
- Modify: `src/gas/dispatcher.js`（全部替換）

- [ ] **Step 1: 用以下內容替換整個 dispatcher.js（骨架 + doGet + 工具）**

```javascript
/**
 * Conversational CRM — dispatcher.js
 * 版本：v3.0 (Merged) — 2026-04-09
 *
 * 功能：
 *   1. doGet  — HTML 介面（無 action）或 RESTful JSON API（有 action 參數）
 *   2. doPost — 兩階段流程（parseOnly / confirmWrite / retrySlack）
 *              + Dashboard CRUD（logFeedback / updateDealStage / addCustomer 等）
 *   3. 四大 NLU Handler：CREATE_ENTITY / UPDATE_PIPELINE / LOG_INTERACTION / SCHEDULE_ACTION
 *   4. Fuzzy Matching 搜尋 Customers.Company_Name
 *   5. Stage_Changed_Events 自動記錄
 */

// ============================================================
// Web App 入口 — doGet（雙模）
// ============================================================

/**
 * GET 入口：
 *   無 action → 回傳前端 HTML
 *   有 action → RESTful JSON API（供 Dashboard）
 */
function doGet(e) {
  const action = (e && e.parameter && e.parameter.action) ? e.parameter.action : null;

  if (action) {
    const routes = {
      getCustomers:      function() { return getSheetData_('Customers'); },
      getDeals:          function() { return getSheetData_('Deal_Matrix'); },
      getInteractions:   function() { return getSheetData_('Interactions'); },
      getStakeholders:   function() { return getSheetData_('Stakeholders'); },
      getProductLines:   function() { return getSheetData_('Product_Lines'); },
      getStageEvents:    function() { return getSheetData_('Stage_Changed_Events'); },
      getPartners:       function() { return getSheetData_('Partners_Sheet'); },
      getDashboardStats: function() { return getDashboardStats_(); }
    };
    if (routes[action]) {
      return jsonResponse_(routes[action]());
    }
    return jsonResponse_({ error: 'Unknown action: ' + action });
  }

  return HtmlService.createHtmlOutputFromFile('frontend')
    .setTitle('Conversational CRM — 3 分鐘儀式')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// ============================================================
// 工具函式（最先定義，其他函式依賴）
// ============================================================

/** 讀取指定 Sheet 全部資料，回傳 JSON 物件陣列 */
function getSheetData_(sheetName) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet || sheet.getLastRow() <= 1) return [];

  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).getValues();
  return data.map(function(row) {
    const obj = {};
    headers.forEach(function(h, i) { obj[h] = row[i]; });
    return obj;
  });
}

/** Dashboard 彙總統計 */
function getDashboardStats_() {
  const deals = getSheetData_('Deal_Matrix');
  const customers = getSheetData_('Customers');
  const interactions = getSheetData_('Interactions');
  const stageCounts = {};
  let totalValue = 0;
  deals.forEach(function(d) {
    const stage = d.Stage || '未知';
    stageCounts[stage] = (stageCounts[stage] || 0) + 1;
    if (typeof d.Est_Value === 'number') totalValue += d.Est_Value;
  });
  return {
    total_customers: customers.length,
    total_deals: deals.length,
    total_interactions: interactions.length,
    total_est_value: totalValue,
    deals_by_stage: stageCounts
  };
}

/** JSON 回應工具 */
function jsonResponse_(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

/** 從 Product_Lines 取得所有產品名稱（供 Gemini Grounding） */
function getProductLineNames_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('Product_Lines');
  if (!sheet || sheet.getLastRow() <= 1) return [];
  return sheet.getRange(2, 2, sheet.getLastRow() - 1, 1).getValues()
    .map(function(r) { return r[0]; })
    .filter(function(n) { return n; });
}

/** 根據公司名取得 Customer_ID（精確匹配） */
function getCustomerIdByName_(companyName) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('Customers');
  if (!sheet || sheet.getLastRow() <= 1) return null;
  const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).getValues();
  for (let i = 0; i < data.length; i++) {
    if (data[i][1] === companyName) return data[i][0];
  }
  return null;
}

/** 根據產品線名稱取得 Product_ID（包含匹配） */
function getProductIdByName_(productName) {
  if (!productName) return null;
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('Product_Lines');
  if (!sheet || sheet.getLastRow() <= 1) return null;
  const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).getValues();
  const norm = productName.trim().toLowerCase();
  for (let i = 0; i < data.length; i++) {
    const dbName = (data[i][1] || '').toLowerCase();
    if (dbName === norm || dbName.includes(norm) || norm.includes(dbName)) {
      return data[i][0];
    }
  }
  return null;
}

/** 在指定 Sheet 以 Company_Name（col 2）搜尋列號 */
function findRowByCompanyName_(sheet, companyName) {
  if (!sheet || sheet.getLastRow() <= 1) return null;
  const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).getValues();
  for (let i = 0; i < data.length; i++) {
    if (data[i][1] === companyName) return { row: i + 2, id: data[i][0] };
  }
  return null;
}

/** 在 Deal_Matrix 以 Customer_ID（col 2）搜尋，選擇性比對 Product_ID（col 3） */
function findDealRow_(dealSheet, customerId, productId) {
  if (!dealSheet || dealSheet.getLastRow() <= 1) return null;
  const data = dealSheet.getRange(2, 1, dealSheet.getLastRow() - 1, 3).getValues();
  for (let i = 0; i < data.length; i++) {
    const idMatch = data[i][1] === customerId;
    const productMatch = !productId || data[i][2] === productId;
    if (idMatch && productMatch) return { row: i + 2, id: data[i][0] };
  }
  return null;
}
```

- [ ] **Step 2: 驗證骨架無語法錯誤**

在 GAS 編輯器中：選取 `doGet` 函式 → 點選「執行」→ 確認執行日誌無錯誤（會因為無 `e` 參數而回傳 HTML，這是預期行為）。

- [ ] **Step 3: Commit**

```bash
git add src/gas/dispatcher.js
git commit -m "feat: dispatcher v3 骨架 — doGet 雙模路由 + 工具函式"
```

---

## Task 2：doPost 兩階段路由 + confirmWrite + retrySlack

**Files:**
- Modify: `src/gas/dispatcher.js`（在 doGet 區塊下方新增）

- [ ] **Step 1: 在 Task 1 程式碼末尾新增以下內容**

```javascript
// ============================================================
// Web App 入口 — doPost（路由）
// ============================================================

/**
 * POST 入口，依 action 路由：
 *   parseOnly     → 呼叫 NLU，回傳解析 JSON（不寫入）
 *   confirmWrite  → 接受確認資料，寫入 Sheets + Slack
 *   retrySlack    → 重試指定任務的 Slack 通知
 *   logFeedback   → HITL 反饋寫入 Eval_Feedback_Sheet
 *   updateDealStage → Dashboard 手動更新 Stage
 *   addCustomer / updateCustomer / deleteCustomer
 *   addDeal / updateDeal / deleteDeal
 *   addStakeholder / updateStakeholder / deleteStakeholder
 */
function doPost(e) {
  try {
    const payload = JSON.parse(e.postData.contents);
    const action = payload.action;

    if (action === 'parseOnly') {
      return jsonResponse_(parseOnly_(payload.raw_text));
    }
    if (action === 'confirmWrite') {
      return jsonResponse_(confirmWrite_(payload.confirmedData));
    }
    if (action === 'retrySlack') {
      return jsonResponse_(retrySlack_(payload.actionData));
    }
    if (action === 'logFeedback') {
      return jsonResponse_({ status: 'ok', result: logEvalFeedback_(payload.data) });
    }
    if (action === 'updateDealStage') {
      return jsonResponse_({ status: 'ok', result: updateDealStage_(payload.dealId, payload.newStage, payload.reason || '', payload.updatedBy || 'Dashboard') });
    }
    // Customer CRUD
    if (action === 'addCustomer')    return jsonResponse_({ status: 'ok', result: addRow_('Customers', payload.data, 'Customer_ID', 'C-') });
    if (action === 'updateCustomer') return jsonResponse_({ status: 'ok', result: updateRow_('Customers', 'Customer_ID', payload.id, payload.data) });
    if (action === 'deleteCustomer') return jsonResponse_({ status: 'ok', result: deleteRow_('Customers', 'Customer_ID', payload.id) });
    // Deal CRUD
    if (action === 'addDeal')    return jsonResponse_({ status: 'ok', result: addRow_('Deal_Matrix', payload.data, 'Deal_ID', 'D-') });
    if (action === 'updateDeal') return jsonResponse_({ status: 'ok', result: updateRow_('Deal_Matrix', 'Deal_ID', payload.id, payload.data) });
    if (action === 'deleteDeal') return jsonResponse_({ status: 'ok', result: deleteRow_('Deal_Matrix', 'Deal_ID', payload.id) });
    // Stakeholder CRUD
    if (action === 'addStakeholder')    return jsonResponse_({ status: 'ok', result: addRow_('Stakeholders', payload.data, 'Stakeholder_ID', 'S-') });
    if (action === 'updateStakeholder') return jsonResponse_({ status: 'ok', result: updateRow_('Stakeholders', 'Stakeholder_ID', payload.id, payload.data) });
    if (action === 'deleteStakeholder') return jsonResponse_({ status: 'ok', result: deleteRow_('Stakeholders', 'Stakeholder_ID', payload.id) });

    return jsonResponse_({ status: 'error', message: 'Unknown action: ' + action });
  } catch (err) {
    return jsonResponse_({ status: 'error', message: err.message });
  }
}

// ============================================================
// 兩階段流程核心
// ============================================================

/**
 * Phase 1：呼叫 Gemini NLU，回傳解析 JSON（不寫入）
 * 前端在此收到結果後顯示預覽，使用者確認後再呼叫 confirmWrite_
 */
function parseOnly_(rawText) {
  try {
    const productNames = getProductLineNames_();
    const parsed = parseOnly(rawText, productNames);  // 呼叫 gemini_nlu.js
    return { status: 'ok', parsed: parsed };
  } catch (err) {
    return { status: 'error', message: err.message };
  }
}

/**
 * Phase 2：接受使用者確認後的 NLU 資料，執行 Sheets 寫入 + Slack 通知
 * @param {Object} confirmedData - NLU JSON（含 intents、entities 等）+ edit_log
 * @returns {Object} { status, written, slackSent, slackError? }
 */
function confirmWrite_(confirmedData) {
  try {
    const result = processPayload_(confirmedData);
    return {
      status: result.slackFailed ? 'partial_success' : 'ok',
      written: result.written,
      slackSent: !result.slackFailed,
      slackError: result.slackError || null
    };
  } catch (err) {
    return { status: 'error', message: err.message };
  }
}

/**
 * 重試 Slack 通知失敗的任務
 * @param {Object} actionData - { task_id, entity_name, task_detail, due_date }
 */
function retrySlack_(actionData) {
  try {
    const slackResult = sendConfirmation(actionData);  // 現有 Slack 函式
    if (!slackResult.success) {
      return { status: 'error', message: slackResult.error };
    }
    // 更新 Action_Backlog：Slack_Notified=true
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName('Action_Backlog');
    if (sheet && actionData.task_id) {
      const ids = sheet.getRange(2, 1, Math.max(sheet.getLastRow() - 1, 1), 1).getValues();
      for (let i = 0; i < ids.length; i++) {
        if (ids[i][0] === actionData.task_id) {
          const now = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');
          sheet.getRange(i + 2, 6).setValue(true);   // Slack_Notified（col 6）
          sheet.getRange(i + 2, 7).setValue(now);    // Slack_Notified_At（col 7）
          break;
        }
      }
    }
    return { status: 'ok' };
  } catch (err) {
    return { status: 'error', message: err.message };
  }
}

// ============================================================
// 核心路由引擎
// ============================================================

/**
 * 依 intents 分派至各 Handler
 * @returns {Object} { written, slackFailed, slackError }
 */
function processPayload_(confirmedData) {
  const intents = confirmedData.intents || [];
  const editLog = confirmedData.edit_log || [];
  const written = {
    entities_created: [],
    pipelines_updated: [],
    interactions_logged: [],
    actions_scheduled: []
  };
  let slackFailed = false;
  let slackError = null;

  if (intents.includes('CREATE_ENTITY')) {
    written.entities_created = handleCreateEntities_(confirmedData.entities || []);
  }
  if (intents.includes('UPDATE_PIPELINE')) {
    written.pipelines_updated = handleUpdatePipelines_(confirmedData.pipelines || []);
  }
  if (intents.includes('LOG_INTERACTION')) {
    written.interactions_logged = handleLogInteractions_(confirmedData.interactions || [], editLog);
  }
  if (intents.includes('SCHEDULE_ACTION')) {
    const r = handleScheduleActions_(confirmedData.actions || []);
    written.actions_scheduled = r.results;
    if (r.slackFailed) { slackFailed = true; slackError = r.slackError; }
  }

  return { written, slackFailed, slackError };
}
```

- [ ] **Step 2: 手動測試路由正確性**

在 GAS 編輯器新增並執行以下測試函式（執行後刪除）：

```javascript
function testDoPostRouting() {
  // 模擬 parseOnly 路由（不實際呼叫 Gemini，只測路由邏輯）
  const fakeE = { postData: { contents: JSON.stringify({ action: 'unknown_action' }) } };
  const result = JSON.parse(doPost(fakeE).getContent());
  Logger.log(result);
  // 預期：{ status: 'error', message: 'Unknown action: unknown_action' }
}
```

Expected 執行日誌：`{ status: 'error', message: 'Unknown action: unknown_action' }`

- [ ] **Step 3: Commit**

```bash
git add src/gas/dispatcher.js
git commit -m "feat: doPost 兩階段路由 + confirmWrite + retrySlack + Dashboard CRUD 路由"
```

---

## Task 3：通用 CRUD Helpers

**Files:**
- Modify: `src/gas/dispatcher.js`（在 processPayload_ 下方新增）

- [ ] **Step 1: 新增 CRUD helpers**

```javascript
// ============================================================
// 通用 CRUD 底層操作
// ============================================================

/**
 * 新增列（依 header 順序組裝），自動產生 ID
 * @param {string} sheetName - 表名
 * @param {Object} data - 欄位名→值的物件（無需包含 ID）
 * @param {string} idHeader - ID 欄位名（如 'Customer_ID'）
 * @param {string} idPrefix - ID 前綴（如 'C-'）
 * @returns {Object} { status: 'ok', id: newId }
 */
function addRow_(sheetName, data, idHeader, idPrefix) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) return { status: 'error', message: 'Sheet not found: ' + sheetName };

  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const newId = generateNextId_(sheet, idPrefix);
  data[idHeader] = newId;
  const rowData = headers.map(function(h) { return data[h] !== undefined ? data[h] : ''; });
  sheet.appendRow(rowData);
  return { status: 'ok', id: newId };
}

/**
 * 更新列（依 ID 搜尋，只更新 data 中有的欄位）
 */
function updateRow_(sheetName, idHeader, id, data) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet || sheet.getLastRow() <= 1) return { status: 'error', message: 'Sheet empty: ' + sheetName };

  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const idCol = headers.indexOf(idHeader) + 1;
  if (idCol === 0) return { status: 'error', message: 'ID header not found: ' + idHeader };

  const ids = sheet.getRange(2, idCol, sheet.getLastRow() - 1, 1).getValues().flat();
  const rowIndex = ids.indexOf(id);
  if (rowIndex === -1) return { status: 'error', message: 'ID not found: ' + id };

  const actualRow = rowIndex + 2;
  for (const key in data) {
    const colIndex = headers.indexOf(key) + 1;
    if (colIndex > 0) sheet.getRange(actualRow, colIndex).setValue(data[key]);
  }
  return { status: 'ok', id: id };
}

/**
 * 刪除列（依 ID 搜尋）
 */
function deleteRow_(sheetName, idHeader, id) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet || sheet.getLastRow() <= 1) return { status: 'error', message: 'Sheet empty: ' + sheetName };

  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const idCol = headers.indexOf(idHeader) + 1;
  const ids = sheet.getRange(2, idCol, sheet.getLastRow() - 1, 1).getValues().flat();
  const rowIndex = ids.indexOf(id);
  if (rowIndex === -1) return { status: 'error', message: 'ID not found: ' + id };

  sheet.deleteRow(rowIndex + 2);
  return { status: 'ok', deletedId: id };
}

/**
 * 通用 ID 產生器（取最後一列的 ID 遞增）
 * 注意：各表有專用 getNextXxxId()，此函式供 addRow_ 使用
 */
function generateNextId_(sheet, prefix) {
  if (sheet.getLastRow() <= 1) return prefix + '0001';
  const lastId = sheet.getRange(sheet.getLastRow(), 1).getValue().toString();
  const numPart = lastId.replace(prefix, '');
  const next = (parseInt(numPart, 10) || 0) + 1;
  return prefix + next.toString().padStart(4, '0');
}
```

- [ ] **Step 2: 手動測試 addRow_ / updateRow_**

在 GAS 編輯器新增並執行：

```javascript
function testCrudHelpers() {
  // 測試 addRow_ 寫入 Customers（需 Customers 表已存在）
  const res = addRow_('Customers', {
    Company_Name: 'TEST公司',
    Industry: '測試業',
    Status: 'Prospect',
    Reporter: 'System',
    Created_At: '2026-04-09'
  }, 'Customer_ID', 'C-');
  Logger.log('addRow_ 結果：' + JSON.stringify(res));
  // 預期：{ status: 'ok', id: 'C-XXXX' }

  // 測試 updateRow_ 更新剛新增的列
  const updateRes = updateRow_('Customers', 'Customer_ID', res.id, { Industry: '已更新業' });
  Logger.log('updateRow_ 結果：' + JSON.stringify(updateRes));
  // 預期：{ status: 'ok', id: 'C-XXXX' }

  // 測試 deleteRow_ 刪除測試資料
  const delRes = deleteRow_('Customers', 'Customer_ID', res.id);
  Logger.log('deleteRow_ 結果：' + JSON.stringify(delRes));
  // 預期：{ status: 'ok', deletedId: 'C-XXXX' }
}
```

- [ ] **Step 3: 執行 testCrudHelpers，確認三步驟均成功**

- [ ] **Step 4: Commit**

```bash
git add src/gas/dispatcher.js
git commit -m "feat: 通用 CRUD helpers — addRow_ / updateRow_ / deleteRow_"
```

---

## Task 4：Fuzzy Matching — Customers 表

**Files:**
- Modify: `src/gas/dispatcher.js`

- [ ] **Step 1: 新增 fuzzyMatchEntity()**

```javascript
// ============================================================
// Fuzzy Matching 引擎（搜尋 Customers.Company_Name）
// ============================================================

/**
 * 在 Customers 表以 Containment Matching 搜尋公司名稱
 * 策略：精確匹配（不分大小寫）→ 包含匹配（閾值 ≥ 0.5）
 * @param {string} inputName - NLU 解析出的公司名
 * @returns {string|null} 正式公司名，或 null（未找到）
 */
function fuzzyMatchEntity(inputName) {
  if (!inputName) return null;
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('Customers');
  if (!sheet || sheet.getLastRow() <= 1) return null;

  // Company_Name 在第 2 欄
  const names = sheet.getRange(2, 2, sheet.getLastRow() - 1, 1).getValues().flat();
  const norm = inputName.trim().toLowerCase();

  // 1. 精確匹配
  for (const name of names) {
    if (typeof name === 'string' && name.toLowerCase() === norm) return name;
  }

  // 2. 包含匹配
  let bestMatch = null;
  let bestScore = 0;
  for (const name of names) {
    if (typeof name !== 'string' || !name) continue;
    const db = name.toLowerCase();
    if (db.includes(norm) || norm.includes(db)) {
      const score = Math.min(norm.length, db.length) / Math.max(norm.length, db.length);
      if (score > bestScore) { bestScore = score; bestMatch = name; }
    }
  }
  return (bestMatch && bestScore >= 0.5) ? bestMatch : null;
}
```

- [ ] **Step 2: 手動測試 fuzzyMatchEntity**

先在 Customers 表手動新增一列：`Company_Name = 瑞昱半導體`，然後執行：

```javascript
function testFuzzyMatch() {
  Logger.log(fuzzyMatchEntity('瑞昱半導體'));   // 預期：'瑞昱半導體'（精確）
  Logger.log(fuzzyMatchEntity('瑞昱'));         // 預期：'瑞昱半導體'（包含）
  Logger.log(fuzzyMatchEntity('不存在公司'));   // 預期：null
  Logger.log(fuzzyMatchEntity(''));             // 預期：null
}
```

- [ ] **Step 3: 確認四個輸出符合預期，Commit**

```bash
git add src/gas/dispatcher.js
git commit -m "feat: fuzzyMatchEntity — 搜尋 Customers.Company_Name"
```

---

## Task 5：handleCreateEntities_ — Customers + Partners_Sheet

**Files:**
- Modify: `src/gas/dispatcher.js`

- [ ] **Step 1: 新增 handleCreateEntities_**

```javascript
// ============================================================
// Handler: CREATE_ENTITY
// ============================================================

/**
 * 建立新客戶（Customers）或夥伴（Partners_Sheet）
 * 若名稱已存在（Fuzzy Match），跳過並回傳提示
 * category='Client' → Customers；category='Partner' → Partners_Sheet
 */
function handleCreateEntities_(entities) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const results = [];

  entities.forEach(function(entity) {
    const isPartner = entity.category === 'Partner';

    if (!isPartner) {
      // --- 寫入 Customers ---
      const match = fuzzyMatchEntity(entity.name);
      if (match) {
        results.push({ name: match, action: 'SKIPPED', reason: '已存在' });
        return;
      }
      const newId = getNextCustomerId();
      const now = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
      const sheet = ss.getSheetByName('Customers');
      // 欄位順序：Customer_ID, Company_Name, Industry, Key_Contact, Lead_Source, Status, Reporter, Created_At
      sheet.appendRow([newId, entity.name, entity.industry || '', '', '', 'Prospect', 'System', now]);
      results.push({ name: entity.name, action: 'CREATED', id: newId, table: 'Customers' });

    } else {
      // --- 寫入 Partners_Sheet ---
      const sheet = ss.getSheetByName('Partners_Sheet');
      if (sheet && sheet.getLastRow() > 1) {
        const names = sheet.getRange(2, 2, sheet.getLastRow() - 1, 1).getValues().flat();
        if (names.some(function(n) { return n === entity.name; })) {
          results.push({ name: entity.name, action: 'SKIPPED', reason: '夥伴已存在' });
          return;
        }
      }
      const newId = getNextPartnerId();
      const now = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
      // 欄位順序：Partner_ID, Partner_Name, Partner_Type, Tier, Status, Reporter, Created_At
      sheet.appendRow([newId, entity.name, '', '', 'Active', 'System', now]);
      results.push({ name: entity.name, action: 'CREATED', id: newId, table: 'Partners_Sheet' });
    }
  });

  return results;
}
```

- [ ] **Step 2: 手動測試 handleCreateEntities_**

```javascript
function testHandleCreateEntities() {
  const entities = [
    { name: 'TEST新客戶ABC', category: 'Client', industry: '科技業' },
    { name: '瑞昱半導體', category: 'Client', industry: 'IC 設計' },  // 已存在 → SKIPPED
    { name: 'TEST新夥伴XYZ', category: 'Partner', industry: '' }
  ];
  const result = handleCreateEntities_(entities);
  Logger.log(JSON.stringify(result, null, 2));
  // 預期：
  // [{ name:'TEST新客戶ABC', action:'CREATED', table:'Customers' },
  //  { name:'瑞昱半導體', action:'SKIPPED', reason:'已存在' },
  //  { name:'TEST新夥伴XYZ', action:'CREATED', table:'Partners_Sheet' }]
}
```

- [ ] **Step 3: 執行測試，確認 CREATED/SKIPPED 行為正確；手動清除測試資料**

- [ ] **Step 4: Commit**

```bash
git add src/gas/dispatcher.js
git commit -m "feat: handleCreateEntities_ — 分流寫入 Customers / Partners_Sheet"
```

---

## Task 6：handleUpdatePipelines_ — Deal_Matrix + Stage_Changed_Events

**Files:**
- Modify: `src/gas/dispatcher.js`

- [ ] **Step 1: 新增 logStageChangeEvent_ 和 handleUpdatePipelines_**

```javascript
// ============================================================
// Handler: UPDATE_PIPELINE
// ============================================================

/**
 * 將階段變更寫入 Stage_Changed_Events（自動，禁止手動刪除）
 */
function logStageChangeEvent_(dealId, fromStage, toStage, reason) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('Stage_Changed_Events');
  if (!sheet) return;
  const now = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');
  const newId = getNextEventId();
  // 欄位順序：Event_ID, Deal_ID, From_Stage, To_Stage, Change_Reason, Updated_By, Timestamp
  sheet.appendRow([newId, dealId, fromStage, toStage, reason || 'AI 自動更新', 'System', now]);
}

/**
 * 更新成交矩陣（若不存在則新建）
 * - Fuzzy Match → Customer_ID
 * - is_pending 覆蓋任意 Stage（Boolean）
 * - Stage 變更時自動寫入 Stage_Changed_Events
 */
function handleUpdatePipelines_(pipelines) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const dealSheet = ss.getSheetByName('Deal_Matrix');
  const results = [];

  pipelines.forEach(function(pipeline) {
    // 1. Resolve customer
    let resolvedName = fuzzyMatchEntity(pipeline.entity_name);
    if (!resolvedName) {
      handleCreateEntities_([{ name: pipeline.entity_name, category: 'Client' }]);
      resolvedName = pipeline.entity_name;
    }
    const customerId = getCustomerIdByName_(resolvedName);

    // 2. Resolve product
    const productId = getProductIdByName_(pipeline.product_id || null);

    // 3. Find existing deal (by Customer_ID, 選擇性比對 Product_ID)
    const existing = findDealRow_(dealSheet, customerId, productId || pipeline.product_id || null);

    if (existing) {
      // 取得舊 Stage（col 6）
      const oldStage = dealSheet.getRange(existing.row, 6).getValue();

      const updateData = { Last_Updated_By: 'System' };
      if (pipeline.stage !== undefined && pipeline.stage !== null) updateData.Stage = pipeline.stage;
      if (pipeline.is_pending !== undefined) updateData.is_pending = pipeline.is_pending ? true : false;
      if (pipeline.est_value !== null && pipeline.est_value !== undefined) updateData.Est_Value = pipeline.est_value;
      if (pipeline.next_action_date) updateData.Next_Follow_Up = pipeline.next_action_date;
      if (pipeline.status_summary) updateData.Status_Summary = pipeline.status_summary;
      if (productId) updateData.Product_ID = productId;

      updateRow_('Deal_Matrix', 'Deal_ID', existing.id, updateData);

      // 若 Stage 有變更，記錄事件軌跡
      if (pipeline.stage && String(pipeline.stage) !== String(oldStage)) {
        logStageChangeEvent_(existing.id, oldStage, pipeline.stage, 'AI 解析業務回報自動更新');
      }

      results.push({ entity_name: resolvedName, action: 'UPDATED', deal_id: existing.id });
    } else {
      // 新建 Deal
      const newId = getNextDealId();
      const now = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');
      // 欄位順序：Deal_ID, Customer_ID, Product_ID, Partner_ID, Partner_Role, Stage, is_pending, Est_Value, Deal_Value, Next_Follow_Up, Status_Summary, Owner, Last_Updated_By
      dealSheet.appendRow([
        newId,
        customerId || resolvedName,
        productId || pipeline.product_id || '',
        '',  // Partner_ID
        '',  // Partner_Role
        pipeline.stage || '0',
        pipeline.is_pending ? true : false,
        pipeline.est_value || '',
        '',  // Deal_Value（成交後才填）
        pipeline.next_action_date || '',
        pipeline.status_summary || '',
        '',  // Owner
        'System'
      ]);
      logStageChangeEvent_(newId, '(新建)', pipeline.stage || '0', '新案件建立');
      results.push({ entity_name: resolvedName, action: 'CREATED', deal_id: newId });
    }
  });

  return results;
}

/**
 * Dashboard 手動更新 Deal Stage（HITL）
 */
function updateDealStage_(dealId, newStage, reason, updatedBy) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('Deal_Matrix');
  if (!sheet || sheet.getLastRow() <= 1) return { error: 'Deal_Matrix 為空' };

  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const stageCol = headers.indexOf('Stage') + 1;
  const idCol = headers.indexOf('Deal_ID');
  const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).getValues();

  for (let i = 0; i < data.length; i++) {
    if (data[i][idCol] === dealId) {
      const oldStage = data[i][stageCol - 1];
      updateRow_('Deal_Matrix', 'Deal_ID', dealId, { Stage: newStage, Last_Updated_By: updatedBy });
      logStageChangeEvent_(dealId, oldStage, newStage, reason || 'Dashboard 手動更新');
      return { dealId: dealId, oldStage: oldStage, newStage: newStage, action: 'UPDATED' };
    }
  }
  return { error: 'Deal not found: ' + dealId };
}
```

- [ ] **Step 2: 手動測試 handleUpdatePipelines_**

```javascript
function testHandleUpdatePipelines() {
  const futureDate = Utilities.formatDate(
    new Date(new Date().getTime() + 7 * 24 * 60 * 60 * 1000),
    Session.getScriptTimeZone(), 'yyyy-MM-dd'
  );
  const pipelines = [
    {
      entity_name: '瑞昱半導體',  // 假設已在 Customers 表
      stage: '2',
      est_value: 3000000,
      next_action_date: futureDate,
      status_summary: '已進入規格確認階段'
    }
  ];
  const result = handleUpdatePipelines_(pipelines);
  Logger.log(JSON.stringify(result, null, 2));
  // 預期：[{ entity_name: '瑞昱半導體', action: 'CREATED' 或 'UPDATED', deal_id: 'D-...' }]
  // 同時確認 Stage_Changed_Events 表有一筆新紀錄
}
```

- [ ] **Step 3: 確認 Deal_Matrix 和 Stage_Changed_Events 均有正確資料**

- [ ] **Step 4: Commit**

```bash
git add src/gas/dispatcher.js
git commit -m "feat: handleUpdatePipelines_ — Deal_Matrix + Stage_Changed_Events + is_pending"
```

---

## Task 7：handleLogInteractions_ — Interactions 表

**Files:**
- Modify: `src/gas/dispatcher.js`

- [ ] **Step 1: 新增 handleLogInteractions_**

```javascript
// ============================================================
// Handler: LOG_INTERACTION
// ============================================================

/**
 * 記錄互動日誌至 Interactions 表
 * 欄位：Interaction_ID, Timestamp, Sales_Rep, Customer_ID, Product_ID,
 *       Partner_ID, Raw_Notes, AI_Key_Insights, Extracted_Intent,
 *       Sentiment, Is_Human_Corrected, Edit_Log
 * @param {Array} interactions - 互動陣列
 * @param {Array} editLog      - 使用者在前端修改的紀錄（JSON 字串化後寫入 Edit_Log）
 */
function handleLogInteractions_(interactions, editLog) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('Interactions');
  const editLogStr = (editLog && editLog.length > 0) ? JSON.stringify(editLog) : '';
  const results = [];

  interactions.forEach(function(interaction) {
    let resolvedName = fuzzyMatchEntity(interaction.entity_name);
    if (!resolvedName) {
      handleCreateEntities_([{ name: interaction.entity_name, category: 'Client' }]);
      resolvedName = interaction.entity_name;
    }
    const customerId = getCustomerIdByName_(resolvedName);

    const newId = getNextInteractionId();
    const now = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');

    // AI_Key_Insights 陣列轉 JSON 字串存入欄位
    const insightsStr = JSON.stringify(interaction.ai_key_insights || []);

    // 欄位順序：Interaction_ID, Timestamp, Sales_Rep, Customer_ID, Product_ID,
    //           Partner_ID, Raw_Notes, AI_Key_Insights, Extracted_Intent,
    //           Sentiment, Is_Human_Corrected, Edit_Log
    sheet.appendRow([
      newId,
      now,
      'System',                              // Sales_Rep（Phase 5 再做使用者識別）
      customerId || resolvedName,            // Customer_ID
      '',                                    // Product_ID（interaction 未必有）
      '',                                    // Partner_ID
      interaction.raw_transcript || '',      // Raw_Notes
      insightsStr,                           // AI_Key_Insights（JSON array string）
      '',                                    // Extracted_Intent（NLU v2 未輸出此欄，留空）
      interaction.sentiment || 'Neutral',    // Sentiment
      false,                                 // Is_Human_Corrected
      editLogStr                             // Edit_Log
    ]);

    results.push({ entity_name: resolvedName, action: 'LOGGED', interaction_id: newId });
  });

  return results;
}
```

- [ ] **Step 2: 手動測試 handleLogInteractions_**

```javascript
function testHandleLogInteractions() {
  const interactions = [{
    entity_name: '瑞昱半導體',
    raw_transcript: '今天拜訪了瑞昱半導體，採購副總對 AI 方案很感興趣...',
    ai_key_insights: ['採購副總高度興趣', '預算評估中', '下週進行技術簡報'],
    sentiment: 'Positive'
  }];
  const result = handleLogInteractions_(interactions, []);
  Logger.log(JSON.stringify(result, null, 2));
  // 預期：[{ entity_name: '瑞昱半導體', action: 'LOGGED', interaction_id: 'INT-...' }]
  // 確認 Interactions 表新增一列，AI_Key_Insights 欄為 JSON 陣列字串
}
```

- [ ] **Step 3: 確認 Interactions 表資料格式正確**

- [ ] **Step 4: Commit**

```bash
git add src/gas/dispatcher.js
git commit -m "feat: handleLogInteractions_ — 寫入 Interactions 新 schema"
```

---

## Task 8：handleScheduleActions_ — Action_Backlog + Slack

**Files:**
- Modify: `src/gas/dispatcher.js`

- [ ] **Step 1: 新增 handleScheduleActions_**

```javascript
// ============================================================
// Handler: SCHEDULE_ACTION
// ============================================================

/**
 * 寫入 Action_Backlog 並發送 Slack 通知
 * NLU 輸出欄位：entity_name, task_detail（非舊版 action_description）, due_date（非舊版 action_date）
 * Action_Backlog 欄位順序：Task_ID, Ref_Entity, Task_Detail, Due_Date,
 *                          Reporter, Slack_Notified, Slack_Notified_At, Status
 * @returns {Object} { results, slackFailed, slackError }
 */
function handleScheduleActions_(actions) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('Action_Backlog');
  const results = [];
  let slackFailed = false;
  let slackError = null;

  actions.forEach(function(action) {
    let resolvedName = fuzzyMatchEntity(action.entity_name);
    if (!resolvedName) {
      handleCreateEntities_([{ name: action.entity_name, category: 'Client' }]);
      resolvedName = action.entity_name;
    }

    const newId = getNextTaskId();
    // 欄位順序：Task_ID, Ref_Entity, Task_Detail, Due_Date, Reporter, Slack_Notified, Slack_Notified_At, Status
    sheet.appendRow([
      newId,
      resolvedName,
      action.task_detail || '',   // 新欄位名（v2.0 system_prompt）
      action.due_date || '',      // 新欄位名（v2.0 system_prompt）
      'System',
      false,
      '',
      'pending'
    ]);

    // 發送 Slack 通知
    const actionData = {
      task_id: newId,
      entity_name: resolvedName,
      task_detail: action.task_detail || '',
      due_date: action.due_date || ''
    };
    const slackResult = sendConfirmation(actionData);

    if (slackResult.success) {
      const now = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');
      const lastRow = sheet.getLastRow();
      sheet.getRange(lastRow, 6).setValue(true);  // Slack_Notified
      sheet.getRange(lastRow, 7).setValue(now);   // Slack_Notified_At
    } else {
      Logger.log('[Slack] 通知失敗 (task_id: ' + newId + '): ' + slackResult.error);
      slackFailed = true;
      slackError = slackResult.error;
    }

    results.push({
      entity_name: resolvedName,
      action: 'SCHEDULED',
      task_id: newId,
      slack_sent: slackResult.success
    });
  });

  return { results, slackFailed, slackError };
}
```

- [ ] **Step 2: 手動測試 handleScheduleActions_（Slack 可能失敗，重點測 Sheets 寫入）**

```javascript
function testHandleScheduleActions() {
  const futureDate = Utilities.formatDate(
    new Date(new Date().getTime() + 7 * 24 * 60 * 60 * 1000),
    Session.getScriptTimeZone(), 'yyyy-MM-dd'
  );
  const actions = [{
    entity_name: '瑞昱半導體',
    task_detail: '安排技術簡報，確認採購副總出席',
    due_date: futureDate
  }];
  const result = handleScheduleActions_(actions);
  Logger.log(JSON.stringify(result, null, 2));
  // 預期：{ results: [{ action: 'SCHEDULED', task_id: 'T-...' }], slackFailed: true/false }
  // 確認 Action_Backlog 表有新列，Task_Detail 欄有內容
}
```

- [ ] **Step 3: 確認 Action_Backlog 列格式正確（特別是 Task_Detail 和 Due_Date 欄位名稱）**

- [ ] **Step 4: Commit**

```bash
git add src/gas/dispatcher.js
git commit -m "feat: handleScheduleActions_ — Action_Backlog + task_detail/due_date + Slack"
```

---

## Task 9：HITL — logEvalFeedback_

**Files:**
- Modify: `src/gas/dispatcher.js`

- [ ] **Step 1: 新增 logEvalFeedback_**

```javascript
// ============================================================
// HITL — Eval Feedback
// ============================================================

/**
 * 將 AI Stage 建議 vs 人工修正記錄至 Eval_Feedback_Sheet
 * 供 Dashboard 前端在使用者修改 Stage 後呼叫
 * @param {Object} data - { Interaction_ID, Product_ID, Original_Raw_Note, AI_Suggested_Stage, Human_Corrected_Stage }
 */
function logEvalFeedback_(data) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('Eval_Feedback_Sheet');
  if (!sheet) return { error: 'Eval_Feedback_Sheet 不存在' };

  const newId = getNextFeedbackId();
  const now = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');

  // 欄位順序：Feedback_ID, Interaction_ID, Product_ID, Original_Raw_Note,
  //           AI_Suggested_Stage, Human_Corrected_Stage, Feedback_Timestamp
  sheet.appendRow([
    newId,
    data.Interaction_ID || '',
    data.Product_ID || '',
    data.Original_Raw_Note || '',
    data.AI_Suggested_Stage || '',
    data.Human_Corrected_Stage || '',
    now
  ]);

  return { id: newId };
}
```

- [ ] **Step 2: 手動測試 logEvalFeedback_**

```javascript
function testLogEvalFeedback() {
  const result = logEvalFeedback_({
    Interaction_ID: 'INT-0001',
    Product_ID: 'P-001',
    Original_Raw_Note: '客戶說要再評估',
    AI_Suggested_Stage: '2',
    Human_Corrected_Stage: '1'
  });
  Logger.log(JSON.stringify(result));
  // 預期：{ id: 'FB-...' }
  // 確認 Eval_Feedback_Sheet 有新列
}
```

- [ ] **Step 3: Commit**

```bash
git add src/gas/dispatcher.js
git commit -m "feat: logEvalFeedback_ — HITL Stage 修正記錄"
```

---

## Task 10：手動測試函式（端對端整合）

**Files:**
- Modify: `src/gas/dispatcher.js`

- [ ] **Step 1: 新增完整整合測試函式**

```javascript
// ============================================================
// 手動測試入口（在 GAS 編輯器執行，測試完可刪除）
// ============================================================

/**
 * 端對端整合測試：模擬完整的 confirmWrite 流程
 * 執行後請手動確認以下表格均有新資料：
 *   - Customers（或顯示 SKIPPED）
 *   - Deal_Matrix（Stage='2'）
 *   - Stage_Changed_Events（一筆新事件）
 *   - Interactions（一筆互動）
 *   - Action_Backlog（一筆任務）
 */
function testFullConfirmWrite() {
  const futureDate = Utilities.formatDate(
    new Date(new Date().getTime() + 7 * 24 * 60 * 60 * 1000),
    Session.getScriptTimeZone(), 'yyyy-MM-dd'
  );

  const testPayload = {
    intents: ['CREATE_ENTITY', 'UPDATE_PIPELINE', 'LOG_INTERACTION', 'SCHEDULE_ACTION'],
    overall_confidence: 0.90,
    missing_fields: [],
    entities: [
      { name: '整合測試科技', category: 'Client', industry: 'IT 服務', matched_entity_id: null, entity_match_confidence: 0 }
    ],
    pipelines: [
      {
        entity_name: '整合測試科技',
        stage: '2',
        is_pending: false,
        product_id: null,
        est_value: 5000000,
        next_action_date: futureDate,
        status_summary: '進入規格確認，預計提案'
      }
    ],
    interactions: [
      {
        entity_name: '整合測試科技',
        raw_transcript: '今天拜訪了整合測試科技，對方採購長表達高度興趣...',
        ai_key_insights: ['採購長積極', '預算已核准', '需要兩週內提案'],
        sentiment: 'Positive'
      }
    ],
    actions: [
      {
        entity_name: '整合測試科技',
        task_detail: '準備技術提案簡報並安排簡報時間',
        due_date: futureDate
      }
    ],
    edit_log: []
  };

  Logger.log('=== testFullConfirmWrite 開始 ===');
  const result = confirmWrite_(testPayload);
  Logger.log(JSON.stringify(result, null, 2));
  Logger.log('=== testFullConfirmWrite 結束 ===');
  // 預期 status: 'ok' 或 'partial_success'（Slack 可能失敗）
  // written.entities_created: [{ action: 'CREATED' }]
  // written.pipelines_updated: [{ action: 'CREATED', deal_id: 'D-...' }]
  // written.interactions_logged: [{ action: 'LOGGED', interaction_id: 'INT-...' }]
  // written.actions_scheduled: [{ action: 'SCHEDULED', task_id: 'T-...' }]
}

/**
 * 測試 doGet RESTful API（直接呼叫 helper，驗證格式）
 */
function testGetCustomers() {
  const data = getSheetData_('Customers');
  Logger.log('Customers 筆數: ' + data.length);
  if (data.length > 0) {
    Logger.log('第一筆 keys: ' + Object.keys(data[0]).join(', '));
    // 預期 keys: Customer_ID, Company_Name, Industry, Key_Contact, Lead_Source, Status, Reporter, Created_At
  }
}
```

- [ ] **Step 2: 執行 testFullConfirmWrite，驗證所有表格均有正確資料**

- [ ] **Step 3: 執行 testGetCustomers，確認 keys 與 SCHEMA 一致**

- [ ] **Step 4: clasp push + 在 GAS 編輯器再次執行確認**

```bash
clasp push
```

- [ ] **Step 5: 最終 Commit**

```bash
git add src/gas/dispatcher.js
git commit -m "feat: 合併版 dispatcher v3.0 — 兩階段流程 + v2 schema + Stage_Changed_Events + RESTful API"
```

---

## 驗收清單

部署完成後，逐項手動確認：

- [ ] `doGet`（無參數）：回傳 frontend.html
- [ ] `doGet?action=getCustomers`：回傳 JSON 陣列
- [ ] `doGet?action=getDashboardStats`：回傳彙總統計 JSON
- [ ] `parseOnly`：回傳 NLU JSON，不寫入任何表格
- [ ] `confirmWrite`（CREATE_ENTITY）：Customers 表新增一列，Customer_ID 格式正確
- [ ] `confirmWrite`（CREATE_ENTITY，Partner）：Partners_Sheet 新增一列
- [ ] `confirmWrite`（UPDATE_PIPELINE，新案件）：Deal_Matrix 新增，Stage_Changed_Events 有 `(新建)` 事件
- [ ] `confirmWrite`（UPDATE_PIPELINE，既有案件 Stage 變更）：Deal_Matrix 更新，Stage_Changed_Events 有變更事件
- [ ] `confirmWrite`（LOG_INTERACTION）：Interactions 表新增，AI_Key_Insights 為 JSON 字串
- [ ] `confirmWrite`（SCHEDULE_ACTION）：Action_Backlog 使用 Task_Detail / Due_Date 欄位
- [ ] `retrySlack`：Action_Backlog 的 Slack_Notified 更新為 true
- [ ] `logFeedback`：Eval_Feedback_Sheet 新增一列
- [ ] `updateDealStage`：Deal_Matrix Stage 更新，Stage_Changed_Events 有 `Dashboard 手動更新` 事件
- [ ] Fuzzy Match：輸入「瑞昱」能命中「瑞昱半導體」
