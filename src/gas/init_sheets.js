/**
 * Conversational CRM — init_sheets.js
 * Phase 1: 自動化建立 Google Sheets 四張核心數據表
 *
 * 功能：
 *   1. 建立 Entity_Index / Strategic_Pipeline / Interaction_Timeline / Action_Backlog
 *   2. 為 Enum 欄位加入 Data Validation（下拉選單）
 *   3. 設定欄位寬度、日期格式、數字格式
 *   4. 提供 ID 自動遞增輔助函式（供 Phase 3 Dispatcher 使用）
 *   5. 防重複初始化安全機制
 *
 * 使用方式：
 *   在 GAS 編輯器中執行 initSheetStructure()
 */

// ============================================================
// 表格定義 (Schema Config)
// ============================================================

const SCHEMA = [
  {
    name: 'Entity_Index',
    headers: ['Entity_ID', 'Name', 'Category', 'Industry', 'Created_At', 'Reporter'],
    columnWidths: [100, 180, 100, 150, 130, 120],
    validations: [
      { col: 3, values: ['Client', 'Partner'] }   // Category
    ],
    formats: [
      { col: 5, format: 'yyyy-MM-dd' }            // Created_At
    ]
  },
  {
    name: 'Strategic_Pipeline',
    headers: ['Project_ID', 'Entity_Name', 'Stage', 'Est_Value', 'Next_Action_Date', 'Status_Summary', 'Owner'],
    columnWidths: [130, 180, 100, 120, 140, 300, 120],
    validations: [
      { col: 3, values: ['尋商', '規格', '提案', '商議', '贏單', '輸單', '暫緩'] }  // Stage
    ],
    formats: [
      { col: 4, format: '#,##0' },                // Est_Value
      { col: 5, format: 'yyyy-MM-dd' }            // Next_Action_Date
    ]
  },
  {
    name: 'Interaction_Timeline',
    // 第 8 欄 Edit_Log 存 JSON 字串，記錄使用者在 EDITING 狀態中修改的欄位
    headers: ['Log_ID', 'Timestamp', 'Entity_Name', 'Raw_Transcript', 'AI_Key_Insights', 'Sentiment', 'Reporter', 'Edit_Log'],
    columnWidths: [100, 160, 180, 400, 300, 100, 120, 200],
    validations: [
      { col: 6, values: ['Positive', 'Neutral', 'Negative'] }  // Sentiment
    ],
    formats: [
      { col: 2, format: 'yyyy-MM-dd HH:mm:ss' }  // Timestamp
    ]
  },
  {
    name: 'Action_Backlog',
    // 移除 GCal_Link；新增 Slack_Notified(6)、Slack_Notified_At(7)、Status(8)
    headers: ['Task_ID', 'Ref_Entity', 'Task_Detail', 'Due_Date', 'Reporter', 'Slack_Notified', 'Slack_Notified_At', 'Status'],
    columnWidths: [100, 180, 300, 130, 120, 120, 160, 100],
    validations: [
      { col: 8, values: ['pending', 'completed'] }  // Status
    ],
    formats: [
      { col: 4, format: 'yyyy-MM-dd' },            // Due_Date
      { col: 7, format: 'yyyy-MM-dd HH:mm:ss' }   // Slack_Notified_At
    ]
  }
];

// ============================================================
// 主函式：初始化所有表格
// ============================================================

/**
 * 從 GAS 編輯器直接執行用（跳過 UI 對話框）
 * 強制重新初始化四張表，結果輸出至執行日誌
 */
function initSheetStructureForce() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  SCHEMA.forEach(table => {
    const sheet = getOrCreateSheet_(ss, table.name);
    setupHeaders_(sheet, table.headers);
    setupColumnWidths_(sheet, table.columnWidths);
    setupValidations_(sheet, table.validations);
    setupFormats_(sheet, table.formats);
    console.log('✅ ' + table.name + ' 初始化完成');
  });

  removeDefaultSheet_(ss);
  console.log('✅ 四張核心表初始化完成：Entity_Index、Strategic_Pipeline、Interaction_Timeline、Action_Backlog');
}

function initSheetStructure() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const ui = SpreadsheetApp.getUi();

  // --- 安全檢查：若任何表已存在且含資料，先確認 ---
  const existingWithData = SCHEMA
    .map(t => t.name)
    .filter(name => {
      const s = ss.getSheetByName(name);
      return s && s.getLastRow() > 1;
    });

  if (existingWithData.length > 0) {
    const response = ui.alert(
      '⚠️ 偵測到現有資料',
      '以下表格已含資料，重新初始化將清除所有內容：\n\n' +
      existingWithData.join(', ') +
      '\n\n確定要繼續嗎？',
      ui.ButtonSet.YES_NO
    );
    if (response !== ui.Button.YES) {
      ui.alert('❌ 已取消初始化。');
      return;
    }
  }

  // --- 逐表建立 ---
  SCHEMA.forEach(table => {
    const sheet = getOrCreateSheet_(ss, table.name);
    setupHeaders_(sheet, table.headers);
    setupColumnWidths_(sheet, table.columnWidths);
    setupValidations_(sheet, table.validations);
    setupFormats_(sheet, table.formats);
  });

  // --- 清除預設空白 Sheet1 ---
  removeDefaultSheet_(ss);

  ui.alert('✅ 四張核心表已成功初始化！\n\n' +
    '• Entity_Index\n• Strategic_Pipeline\n• Interaction_Timeline\n• Action_Backlog');
}

// ============================================================
// 輔助函式：Sheet 建立與格式化
// ============================================================

/**
 * 取得或建立指定名稱的 Sheet
 */
function getOrCreateSheet_(ss, name) {
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
  } else {
    sheet.clear();
    sheet.clearFormats();
  }
  return sheet;
}

/**
 * 設定標題列（粗體、灰底、凍結首列）
 */
function setupHeaders_(sheet, headers) {
  const headerRange = sheet.getRange(1, 1, 1, headers.length);
  headerRange.setValues([headers]);
  headerRange.setFontWeight('bold');
  headerRange.setBackground('#e8eaed');
  headerRange.setFontColor('#202124');
  headerRange.setHorizontalAlignment('center');
  sheet.setFrozenRows(1);
}

/**
 * 設定各欄位寬度
 */
function setupColumnWidths_(sheet, widths) {
  widths.forEach((w, i) => {
    sheet.setColumnWidth(i + 1, w);
  });
}

/**
 * 設定 Data Validation（下拉選單），套用到 row 2 ~ 1000
 */
function setupValidations_(sheet, validations) {
  validations.forEach(v => {
    const rule = SpreadsheetApp.newDataValidation()
      .requireValueInList(v.values, true)
      .setAllowInvalid(false)
      .setHelpText('請從下拉選單中選擇')
      .build();
    sheet.getRange(2, v.col, 999, 1).setDataValidation(rule);
  });
}

/**
 * 設定數字/日期格式，套用到 row 2 ~ 1000
 */
function setupFormats_(sheet, formats) {
  formats.forEach(f => {
    sheet.getRange(2, f.col, 999, 1).setNumberFormat(f.format);
  });
}

/**
 * 刪除預設的空白 Sheet1（如果存在且為空）
 */
function removeDefaultSheet_(ss) {
  const defaultSheet = ss.getSheetByName('Sheet1') || ss.getSheetByName('工作表1');
  if (defaultSheet && defaultSheet.getLastRow() <= 1 && defaultSheet.getLastColumn() <= 1) {
    // 確保至少有其他 sheet 才能刪除
    if (ss.getSheets().length > 1) {
      ss.deleteSheet(defaultSheet);
    }
  }
}

// ============================================================
// ID 自動遞增輔助函式（供 Phase 3 Dispatcher 使用）
// ============================================================

/**
 * 產生下一個 Entity ID (格式: E-0001)
 * @returns {string} 新的 Entity_ID
 */
function getNextEntityId() {
  return getNextId_('Entity_Index', 'E-', 4);
}

/**
 * 產生下一個 Project ID (格式: P-2025-0001)
 * @returns {string} 新的 Project_ID
 */
function getNextProjectId() {
  const year = new Date().getFullYear();
  return getNextId_('Strategic_Pipeline', 'P-' + year + '-', 4);
}

/**
 * 產生下一個 Log ID (格式: L-00001)
 * @returns {string} 新的 Log_ID
 */
function getNextLogId() {
  return getNextId_('Interaction_Timeline', 'L-', 5);
}

/**
 * 產生下一個 Task ID (格式: T-00001)
 * @returns {string} 新的 Task_ID
 */
function getNextTaskId() {
  return getNextId_('Action_Backlog', 'T-', 5);
}

/**
 * 通用 ID 生成器：讀取指定 sheet 最後一筆 ID，遞增 +1
 * @param {string} sheetName - 表格名稱
 * @param {string} prefix    - ID 前綴 (如 'E-', 'P-2025-')
 * @param {number} digits    - 流水號位數
 * @returns {string} 新 ID
 */
function getNextId_(sheetName, prefix, digits) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(sheetName);

  if (!sheet || sheet.getLastRow() <= 1) {
    // 表格為空，從 1 開始
    return prefix + String(1).padStart(digits, '0');
  }

  // 讀取第一欄所有 ID
  const ids = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues().flat();
  let maxNum = 0;

  ids.forEach(id => {
    if (typeof id === 'string' && id.startsWith(prefix)) {
      const numPart = parseInt(id.slice(prefix.length), 10);
      if (!isNaN(numPart) && numPart > maxNum) {
        maxNum = numPart;
      }
    }
  });

  return prefix + String(maxNum + 1).padStart(digits, '0');
}
