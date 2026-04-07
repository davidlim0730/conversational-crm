/**
 * Conversational CRM — weekly_reminder.js
 * Sprint 2+3: 每週批次提醒模組
 *
 * 功能：
 *   1. setupWeeklyTriggers()  — 建立週五 18:00 + 週一 08:00 兩個 Time-driven Trigger
 *   2. deleteWeeklyTriggers() — 清除所有 weekly reminder triggers
 *   3. sendFridayPreview()    — 傳送下週待辦預覽（週五 18:00 觸發）
 *   4. sendMondayConfirm()    — 傳送本週待辦確認（週一 08:00 觸發）
 *
 * 使用方式：
 *   在 GAS 編輯器執行 setupWeeklyTriggers() 一次即可設定排程
 */

// ============================================================
// Trigger 設定
// ============================================================

/**
 * 建立兩個 Time-driven Trigger：
 *   - 每週五 18:00 執行 sendFridayPreview
 *   - 每週一 08:00 執行 sendMondayConfirm
 */
function setupWeeklyTriggers() {
  // 先清除舊的避免重複
  deleteWeeklyTriggers();

  ScriptApp.newTrigger('sendFridayPreview')
    .timeBased()
    .onWeekDay(ScriptApp.WeekDay.FRIDAY)
    .atHour(18)
    .create();

  ScriptApp.newTrigger('sendMondayConfirm')
    .timeBased()
    .onWeekDay(ScriptApp.WeekDay.MONDAY)
    .atHour(8)
    .create();

  Logger.log('✅ 已建立每週提醒 Triggers：週五 18:00 + 週一 08:00');
}

/**
 * 清除所有 weekly reminder triggers（sendFridayPreview / sendMondayConfirm）
 */
function deleteWeeklyTriggers() {
  const triggers = ScriptApp.getProjectTriggers();
  let deleted = 0;
  triggers.forEach(trigger => {
    const handlerFunction = trigger.getHandlerFunction();
    if (handlerFunction === 'sendFridayPreview' || handlerFunction === 'sendMondayConfirm') {
      ScriptApp.deleteTrigger(trigger);
      deleted++;
    }
  });
  Logger.log('已清除 ' + deleted + ' 個 weekly reminder triggers');
}

// ============================================================
// 觸發函式
// ============================================================

/**
 * 週五 18:00：傳送下週待辦預覽
 */
function sendFridayPreview() {
  sendWeeklyReminder_('friday');
}

/**
 * 週一 08:00：傳送本週待辦確認
 */
function sendMondayConfirm() {
  sendWeeklyReminder_('monday');
}

// ============================================================
// 內部函式
// ============================================================

/**
 * 查詢 Action_Backlog 並發送每週提醒
 * @param {string} mode - 'friday' | 'monday'
 */
function sendWeeklyReminder_(mode) {
  try {
    const { startDate, endDate } = getDateRange_(mode);
    const dateRangeLabel = formatDateLabel_(startDate) + ' – ' + formatDateLabel_(endDate);
    const actionItems = fetchPendingActions_(startDate, endDate);

    Logger.log('[WeeklyReminder] mode=' + mode + ', range=' + dateRangeLabel + ', items=' + actionItems.length);

    const result = sendReminder(actionItems, mode, dateRangeLabel);
    if (!result.success) {
      Logger.log('[WeeklyReminder] Slack 發送失敗: ' + result.error);
    } else {
      Logger.log('[WeeklyReminder] ✅ 成功發送');
    }
  } catch (error) {
    Logger.log('[WeeklyReminder] 執行錯誤: ' + error.message);
  }
}

/**
 * 計算日期範圍
 * @param {string} mode - 'friday' 回傳下週 Mon-Sun；'monday' 回傳本週 Mon-Sun
 * @returns {Object} { startDate: Date, endDate: Date }
 */
function getDateRange_(mode) {
  const today = new Date();
  const dayOfWeek = today.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat

  if (mode === 'friday') {
    // 計算「下週一」：今天 + (8 - dayOfWeek) % 7 天，若已是週五則加 3 天
    const daysToNextMonday = (8 - dayOfWeek) % 7 || 7;
    const nextMonday = new Date(today);
    nextMonday.setDate(today.getDate() + daysToNextMonday);

    const nextSunday = new Date(nextMonday);
    nextSunday.setDate(nextMonday.getDate() + 6);

    return { startDate: nextMonday, endDate: nextSunday };

  } else {
    // 'monday'：本週一（今天往回找到週一）
    const daysToThisMonday = (dayOfWeek === 0) ? 6 : dayOfWeek - 1;
    const thisMonday = new Date(today);
    thisMonday.setDate(today.getDate() - daysToThisMonday);

    const thisSunday = new Date(thisMonday);
    thisSunday.setDate(thisMonday.getDate() + 6);

    return { startDate: thisMonday, endDate: thisSunday };
  }
}

/**
 * 從 Action_Backlog 批次讀取 Status=pending 且 Due_Date 在範圍內的記錄
 * 最多讀取 50 列
 * @param {Date} startDate
 * @param {Date} endDate
 * @returns {Array} actionItems 陣列，每筆含 { entity_name, action_description, action_date }
 */
function fetchPendingActions_(startDate, endDate) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('Action_Backlog');

  if (!sheet || sheet.getLastRow() <= 1) return [];

  const maxRows = Math.min(sheet.getLastRow() - 1, 50);
  // 讀取 Ref_Entity(2)、Task_Detail(3)、Due_Date(4)、Status(8)
  const data = sheet.getRange(2, 1, maxRows, 8).getValues();

  const startStr = Utilities.formatDate(startDate, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  const endStr   = Utilities.formatDate(endDate,   Session.getScriptTimeZone(), 'yyyy-MM-dd');

  return data
    .filter(row => {
      const status    = String(row[7] || '').toLowerCase();
      const dueDateRaw = row[3];
      if (status !== 'pending') return false;
      if (!dueDateRaw) return false;

      // Due_Date 可能是 Date 物件或字串
      let dueDateStr;
      if (dueDateRaw instanceof Date) {
        dueDateStr = Utilities.formatDate(dueDateRaw, Session.getScriptTimeZone(), 'yyyy-MM-dd');
      } else {
        dueDateStr = String(dueDateRaw).substring(0, 10);
      }

      return dueDateStr >= startStr && dueDateStr <= endStr;
    })
    .map(row => {
      let dueDateStr;
      if (row[3] instanceof Date) {
        dueDateStr = Utilities.formatDate(row[3], Session.getScriptTimeZone(), 'yyyy-MM-dd');
      } else {
        dueDateStr = String(row[3]).substring(0, 10);
      }
      return {
        entity_name:         String(row[1] || ''),
        action_description:  String(row[2] || ''),
        action_date:         dueDateStr
      };
    });
}

/**
 * 將 Date 物件格式化為 M/DD 顯示用字串
 * @param {Date} date
 * @returns {string} 如 "4/07"
 */
function formatDateLabel_(date) {
  return Utilities.formatDate(date, Session.getScriptTimeZone(), 'M/dd');
}

// ============================================================
// 測試函式（在 GAS 編輯器直接執行）
// ============================================================

/**
 * 測試 setupWeeklyTriggers
 * 執行後在 GAS → Triggers 頁面確認有兩個新觸發器
 */
function testSetupTriggers() {
  Logger.log('=== testSetupTriggers 開始 ===');
  setupWeeklyTriggers();
  const triggers = ScriptApp.getProjectTriggers();
  const relevant = triggers.filter(t =>
    t.getHandlerFunction() === 'sendFridayPreview' ||
    t.getHandlerFunction() === 'sendMondayConfirm'
  );
  Logger.log('已建立的 weekly triggers 數量: ' + relevant.length);
  relevant.forEach(t => Logger.log(' - ' + t.getHandlerFunction()));
  Logger.log('=== testSetupTriggers 結束 ===');
}
