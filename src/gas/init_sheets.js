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
// 版本：v2.0 — 2026-04-08
// 合併自：舊版主 CRM + Satellite Sales OS v2
// 共 9 張表，詳細欄位定義見 product-owner-management/MERGED_SCHEMA.md
// ============================================================

const SCHEMA = [
  // 1. 客戶表（原 Entity_Index Category=Client）
  {
    name: 'Customers',
    headers: ['Customer_ID', 'Company_Name', 'Industry', 'Key_Contact', 'Lead_Source', 'Status', 'Reporter', 'Created_At'],
    columnWidths: [100, 200, 150, 150, 150, 100, 120, 130],
    validations: [
      { col: 6, values: ['Prospect', 'Active', 'Churned'] }  // Status
    ],
    formats: [
      { col: 8, format: 'yyyy-MM-dd' }  // Created_At
    ]
  },
  // 2. 合作夥伴表（原 Entity_Index Category=Partner）
  {
    name: 'Partners_Sheet',
    headers: ['Partner_ID', 'Partner_Name', 'Partner_Type', 'Tier', 'Status', 'Reporter', 'Created_At'],
    columnWidths: [100, 200, 100, 100, 100, 120, 130],
    validations: [
      { col: 3, values: ['SI', 'Agency', 'Tech'] },              // Partner_Type
      { col: 5, values: ['Active', 'Inactive'] }                  // Status
    ],
    formats: [
      { col: 7, format: 'yyyy-MM-dd' }  // Created_At
    ]
  },
  // 3. 交易矩陣表（原 Strategic_Pipeline，Stage 改為數字）
  {
    name: 'Deal_Matrix',
    headers: ['Deal_ID', 'Customer_ID', 'Product_ID', 'Partner_ID', 'Partner_Role', 'Stage', 'is_pending', 'Est_Value', 'Deal_Value', 'Next_Follow_Up', 'Status_Summary', 'Owner', 'Last_Updated_By'],
    columnWidths: [130, 100, 100, 100, 120, 80, 90, 120, 120, 130, 300, 120, 150],
    validations: [
      { col: 6, values: ['0', '1', '2', '3', '4', '5', '6', '成交', '失敗'] },  // Stage
      { col: 7, values: ['TRUE', 'FALSE'] }                                        // is_pending
    ],
    formats: [
      { col: 8, format: '#,##0' },               // Est_Value
      { col: 9, format: '#,##0' },               // Deal_Value
      { col: 10, format: 'yyyy-MM-dd' }          // Next_Follow_Up
    ]
  },
  // 4. 業務互動紀錄表（原 Interaction_Timeline，欄位取聯集）
  {
    name: 'Interactions',
    headers: ['Interaction_ID', 'Timestamp', 'Sales_Rep', 'Customer_ID', 'Product_ID', 'Partner_ID', 'Raw_Notes', 'AI_Key_Insights', 'Extracted_Intent', 'Sentiment', 'Is_Human_Corrected', 'Edit_Log'],
    columnWidths: [120, 160, 120, 100, 100, 100, 400, 300, 200, 100, 130, 200],
    validations: [
      { col: 10, values: ['Positive', 'Neutral', 'Negative'] },  // Sentiment
      { col: 11, values: ['TRUE', 'FALSE'] }                       // Is_Human_Corrected
    ],
    formats: [
      { col: 2, format: 'yyyy-MM-dd HH:mm:ss' }  // Timestamp
    ]
  },
  // 5. 利害關係人表（新版帶入）
  {
    name: 'Stakeholders',
    headers: ['Stakeholder_ID', 'Customer_ID', 'Name', 'Role', 'Attitude', 'Last_Contact_Date'],
    columnWidths: [120, 100, 150, 130, 120, 140],
    validations: [
      { col: 4, values: ['Champion', 'Decision Maker', 'User', 'Gatekeeper'] },  // Role
      { col: 5, values: ['Supportive', 'Neutral', 'Opposed'] }                    // Attitude
    ],
    formats: [
      { col: 6, format: 'yyyy-MM-dd' }  // Last_Contact_Date
    ]
  },
  // 6. 階段變更事件表（新版帶入，自動寫入，禁止手動刪除）
  {
    name: 'Stage_Changed_Events',
    headers: ['Event_ID', 'Deal_ID', 'From_Stage', 'To_Stage', 'Change_Reason', 'Updated_By', 'Timestamp'],
    columnWidths: [120, 130, 100, 100, 300, 150, 160],
    validations: [],
    formats: [
      { col: 7, format: 'yyyy-MM-dd HH:mm:ss' }  // Timestamp
    ]
  },
  // 7. AI 學習反饋表（Phase 4+5 HITL 核心）
  {
    name: 'Eval_Feedback_Sheet',
    headers: ['Feedback_ID', 'Interaction_ID', 'Product_ID', 'Original_Raw_Note', 'AI_Suggested_Stage', 'Human_Corrected_Stage', 'Feedback_Timestamp'],
    columnWidths: [120, 120, 100, 400, 130, 150, 160],
    validations: [],
    formats: [
      { col: 7, format: 'yyyy-MM-dd HH:mm:ss' }  // Feedback_Timestamp
    ]
  },
  // 8. 任務待辦表（舊版保留，Ref_Entity 維持字串至 Phase 5）
  {
    name: 'Action_Backlog',
    headers: ['Task_ID', 'Ref_Entity', 'Task_Detail', 'Due_Date', 'Reporter', 'Slack_Notified', 'Slack_Notified_At', 'Status'],
    columnWidths: [100, 180, 300, 130, 120, 120, 160, 100],
    validations: [
      { col: 8, values: ['pending', 'completed'] }  // Status
    ],
    formats: [
      { col: 4, format: 'yyyy-MM-dd' },             // Due_Date
      { col: 7, format: 'yyyy-MM-dd HH:mm:ss' }    // Slack_Notified_At
    ]
  },
  // 9. 產品線表（新版帶入）
  {
    name: 'Product_Lines',
    headers: ['Product_ID', 'Name', 'Product_Owner', 'USP', 'Status', 'Target_Segments'],
    columnWidths: [100, 180, 130, 300, 100, 200],
    validations: [
      { col: 5, values: ['Active', 'Beta', 'Sunset'] }  // Status
    ],
    formats: []
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

// ============================================================
// ID 生成函式（v2.0 — 對應合併後 9 張表）
// ============================================================

/** 產生下一個 Customer ID (格式: C-0001) */
function getNextCustomerId() {
  return getNextId_('Customers', 'C-', 4);
}

/** 產生下一個 Partner ID (格式: PA-0001) */
function getNextPartnerId() {
  return getNextId_('Partners_Sheet', 'PA-', 4);
}

/** 產生下一個 Deal ID (格式: D-2026-0001) */
function getNextDealId() {
  const year = new Date().getFullYear();
  return getNextId_('Deal_Matrix', 'D-' + year + '-', 4);
}

/** 產生下一個 Interaction ID (格式: I-00001) */
function getNextInteractionId() {
  return getNextId_('Interactions', 'I-', 5);
}

/** 產生下一個 Stakeholder ID (格式: SK-0001) */
function getNextStakeholderId() {
  return getNextId_('Stakeholders', 'SK-', 4);
}

/** 產生下一個 Event ID (格式: EV-00001) */
function getNextEventId() {
  return getNextId_('Stage_Changed_Events', 'EV-', 5);
}

/** 產生下一個 Feedback ID (格式: FB-00001) */
function getNextFeedbackId() {
  return getNextId_('Eval_Feedback_Sheet', 'FB-', 5);
}

/** 產生下一個 Task ID (格式: T-00001) */
function getNextTaskId() {
  return getNextId_('Action_Backlog', 'T-', 5);
}

/** 產生下一個 Product ID (格式: PL-0001) */
function getNextProductId() {
  return getNextId_('Product_Lines', 'PL-', 4);
}

// ---- 舊版相容性別名（供現有 dispatcher.js 過渡期使用，Phase 5 移除） ----
/** @deprecated 請改用 getNextCustomerId() */
function getNextEntityId() {
  return getNextCustomerId();
}
/** @deprecated 請改用 getNextDealId() */
function getNextProjectId() {
  return getNextDealId();
}
/** @deprecated 請改用 getNextInteractionId() */
function getNextLogId() {
  return getNextInteractionId();
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
