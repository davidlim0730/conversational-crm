/**
 * Conversational CRM — slack_notifier.js
 * Sprint 2+3: Slack Bot 通知模組
 *
 * 功能：
 *   1. sendConfirmation(actionData)  — confirmWrite 後發送即時確認 DM
 *   2. sendReminder(actionItems, mode, dateRangeLabel) — 每週批次提醒
 *
 * Script Properties（需在 GAS 設定）：
 *   SLACK_BOT_TOKEN  — Slack Bot Token（以 xoxb- 開頭）
 *   USER_EMAIL       — 使用者 Email（用於 lookup Slack User ID）
 *   SLACK_USER_ID    — 自動快取，不需手動設定
 */

// ============================================================
// 公開函式
// ============================================================

/**
 * 在 confirmWrite 成功寫入 Action_Backlog 後，發送 Slack DM 確認通知
 * @param {Object} actionData - { task_id, entity_name, action_description, action_date }
 * @returns {Object} { success: boolean, error?: string }
 */
function sendConfirmation(actionData) {
  try {
    const userId = getSlackUserId_();
    const blocks = buildConfirmationBlocks_(actionData);
    postMessage_(userId, blocks);
    return { success: true };
  } catch (error) {
    Logger.log('[Slack] sendConfirmation 失敗: ' + error.message);
    return { success: false, error: error.message };
  }
}

/**
 * 發送每週批次提醒（週五預覽 / 週一確認）
 * @param {Array}  actionItems    - Action_Backlog 記錄陣列
 * @param {string} mode           - 'friday' | 'monday'
 * @param {string} dateRangeLabel - 日期範圍說明文字（如「2025/04/07 – 04/13」）
 * @returns {Object} { success: boolean, error?: string }
 */
function sendReminder(actionItems, mode, dateRangeLabel) {
  try {
    const userId = getSlackUserId_();
    const blocks = buildReminderBlocks_(actionItems, mode, dateRangeLabel);
    postMessage_(userId, blocks);
    return { success: true };
  } catch (error) {
    Logger.log('[Slack] sendReminder 失敗: ' + error.message);
    return { success: false, error: error.message };
  }
}

// ============================================================
// 內部函式：User ID 查找與快取
// ============================================================

/**
 * 透過 USER_EMAIL 取得 Slack User ID，結果快取至 Script Properties
 * @returns {string} Slack User ID（以 U 開頭）
 */
function getSlackUserId_() {
  const props = PropertiesService.getScriptProperties();

  // 優先使用快取
  const cached = props.getProperty('SLACK_USER_ID');
  if (cached) return cached;

  const token = props.getProperty('SLACK_BOT_TOKEN');
  const email = props.getProperty('USER_EMAIL');

  if (!token) throw new Error('請在 Script Properties 設定 SLACK_BOT_TOKEN');
  if (!email) throw new Error('請在 Script Properties 設定 USER_EMAIL');

  const url = 'https://slack.com/api/users.lookupByEmail?email=' + encodeURIComponent(email);
  const response = UrlFetchApp.fetch(url, {
    method: 'get',
    headers: { 'Authorization': 'Bearer ' + token },
    muteHttpExceptions: true
  });

  const data = JSON.parse(response.getContentText());

  if (!data.ok) {
    throw new Error('Slack users.lookupByEmail 失敗: ' + data.error);
  }

  const userId = data.user.id;
  props.setProperty('SLACK_USER_ID', userId); // 快取
  return userId;
}

// ============================================================
// 內部函式：發送訊息（含 Rate Limit 重試）
// ============================================================

/**
 * 呼叫 Slack chat.postMessage，支援 HTTP 429 Retry-After 重試（最多 3 次）
 * @param {string} channel - Slack User ID（DM）或 Channel ID
 * @param {Array}  blocks  - Slack Block Kit 陣列
 */
function postMessage_(channel, blocks) {
  const token = PropertiesService.getScriptProperties().getProperty('SLACK_BOT_TOKEN');
  if (!token) throw new Error('請在 Script Properties 設定 SLACK_BOT_TOKEN');

  const url = 'https://slack.com/api/chat.postMessage';
  const payload = JSON.stringify({ channel: channel, blocks: blocks });
  const options = {
    method: 'post',
    contentType: 'application/json',
    headers: { 'Authorization': 'Bearer ' + token },
    payload: payload,
    muteHttpExceptions: true
  };

  const maxRetries = 3;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const response = UrlFetchApp.fetch(url, options);
    const statusCode = response.getResponseCode();

    if (statusCode === 429) {
      // Rate Limit：讀取 Retry-After header，等待後重試
      const retryAfter = parseInt(response.getHeaders()['Retry-After'] || '1', 10);
      Logger.log('[Slack] Rate Limit (429)，等待 ' + retryAfter + ' 秒後重試（第 ' + attempt + '/' + maxRetries + ' 次）');
      Utilities.sleep(retryAfter * 1000);
      continue;
    }

    const data = JSON.parse(response.getContentText());
    if (!data.ok) {
      throw new Error('Slack chat.postMessage 失敗: ' + data.error);
    }
    return; // 成功
  }

  throw new Error('Slack chat.postMessage 重試 ' + maxRetries + ' 次後仍失敗（Rate Limit）');
}

// ============================================================
// 內部函式：Block Kit 建構器
// ============================================================

/**
 * 建構即時確認通知的 Block Kit blocks
 * @param {Object} actionData - { task_id, entity_name, action_description, action_date }
 * @returns {Array} Slack Block Kit 陣列
 */
function buildConfirmationBlocks_(actionData) {
  return [
    {
      type: 'header',
      text: { type: 'plain_text', text: '✅ CRM 任務已建立', emoji: true }
    },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: '*客戶/夥伴*\n' + (actionData.entity_name || '—') },
        { type: 'mrkdwn', text: '*任務 ID*\n' + (actionData.task_id || '—') }
      ]
    },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: '*任務描述*\n' + (actionData.action_description || '—') }
    },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: '*截止日期*\n' + (actionData.action_date || '—') },
        { type: 'mrkdwn', text: '*狀態*\npending' }
      ]
    },
    { type: 'divider' }
  ];
}

/**
 * 建構每週提醒通知的 Block Kit blocks
 * @param {Array}  actionItems    - Action_Backlog 記錄陣列（每筆含 entity_name, action_description, action_date）
 * @param {string} mode           - 'friday' | 'monday'
 * @param {string} dateRangeLabel - 日期範圍說明文字
 * @returns {Array} Slack Block Kit 陣列
 */
function buildReminderBlocks_(actionItems, mode, dateRangeLabel) {
  const headerText = mode === 'friday'
    ? '📋 下週待辦預覽（' + dateRangeLabel + '）'
    : '🔔 本週待辦確認（' + dateRangeLabel + '）';

  const blocks = [
    {
      type: 'header',
      text: { type: 'plain_text', text: headerText, emoji: true }
    }
  ];

  if (!actionItems || actionItems.length === 0) {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: '本週期間無待辦事項 🎉' }
    });
    return blocks;
  }

  // 每筆任務渲染為一個 section
  actionItems.forEach((item, idx) => {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*${idx + 1}. ${item.entity_name || '—'}*\n` +
              `${item.action_description || '—'}\n` +
              `📅 ${item.action_date || '—'}`
      }
    });
  });

  blocks.push({ type: 'divider' });
  return blocks;
}

// ============================================================
// 測試函式（在 GAS 編輯器直接執行）
// ============================================================

/**
 * 測試 sendConfirmation
 * 需先在 Script Properties 設定 SLACK_BOT_TOKEN 與 USER_EMAIL
 */
function testSlackNotifier() {
  Logger.log('=== testSlackNotifier 開始 ===');

  const testAction = {
    task_id: 'T-TEST-001',
    entity_name: '測試客戶股份有限公司',
    action_description: '準備技術簡報投影片',
    action_date: '2025-04-15'
  };

  const result = sendConfirmation(testAction);
  Logger.log('sendConfirmation 結果: ' + JSON.stringify(result));

  if (result.success) {
    Logger.log('✅ Slack DM 送達成功！請至 Slack 確認訊息。');
  } else {
    Logger.log('❌ 失敗: ' + result.error);
  }

  Logger.log('=== testSlackNotifier 結束 ===');
}
