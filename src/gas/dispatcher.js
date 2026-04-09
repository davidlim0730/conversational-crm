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
