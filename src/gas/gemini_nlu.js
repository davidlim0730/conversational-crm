/**
 * Conversational CRM — gemini_nlu.js
 * Phase 4 (Sprint 2+3): Gemini NLU 解析模組（GAS 伺服器端）
 *
 * 使用方式：
 *   在 GAS 腳本屬性中設定 GEMINI_API_KEY
 *   Project Settings → Script Properties → 新增 GEMINI_API_KEY
 */

// ============================================================
// 系統 Prompt（從 src/nlu/system_prompt.md 同步過來）
// ============================================================

const SYSTEM_PROMPT = `你是一位資深 CRM 數據解析專家 (Parser Agent)。你的職責是接收業務人員 (BD) 的「意識流回報」——一段自然語言的文字輸入——並將其轉換為結構化的 JSON 指令，供下游的自動化調度器 (Dispatcher) 執行 CRM 操作。

## 核心行為規範
1. 你只輸出 JSON。不要加任何解釋、寒暄或 markdown 標記。
2. 一段回報可能觸發多個意圖。你必須完整解析所有意圖，不可遺漏。
3. 今天的日期會在每次呼叫時由使用者訊息的第一行提供，格式為「今天的日期：YYYY-MM-DD」，作為日期推算的基準。
4. 所有日期輸出一律使用 YYYY-MM-DD 格式。
5. 金額一律轉換為純數字（例如「50萬」→500000，「兩千萬」→20000000）。

## 意圖路由
- CREATE_ENTITY：提及一個全新的公司、客戶或合作夥伴
- UPDATE_PIPELINE：提及案件階段變更、預估金額、或下次跟進日期
- LOG_INTERACTION：描述了一次拜訪、會議、電話等互動細節
- SCHEDULE_ACTION：明確提到需要安排後續任務或提醒

## Entity 匹配規則
在輸出 entities 陣列時，必須根據「現有客戶名單」（Grounding Context，由系統在 Prompt 末尾動態附加）進行比對：
1. 若使用者提及的名稱與名單中某筆完全相符或高度相似（如「台積」→「台積電」），設定 matched_entity_id 為該筆 Entity_ID，並在 entity_match_confidence 給出信心分數（0 到 1）。
2. 若信心度 ≥ 0.80，視為確定匹配。
3. 若信心度介於 0.50–0.79，仍填入 matched_entity_id，但下游 UI 會要求使用者確認。
4. 若信心度 < 0.50，或名稱在名單中完全找不到，設定 matched_entity_id 為 null，視為新客戶。
5. 若系統未提供「現有客戶名單」，matched_entity_id 一律設為 null，entity_match_confidence 設為 0。
6. 一段回報中可能涉及多個 Entity，每個都需獨立匹配。

## Stage 只能是以下之一
尋商、規格、提案、商議、贏單、輸單、暫緩

## Category 只能是以下之一
Client、Partner

## Sentiment 只能是以下之一
Positive、Neutral、Negative

## 置信度與缺失欄位
- overall_confidence（0–1）：整體解析信心分數。若輸入文字過短、模糊，或缺乏關鍵資訊，給出較低分數。
- missing_fields：列出 AI 無法解析、需要使用者手動補填的欄位名稱（如 ["action_date", "est_value"]）。

## JSON 輸出格式
{
  "intents": ["CREATE_ENTITY", "UPDATE_PIPELINE", "LOG_INTERACTION", "SCHEDULE_ACTION"],
  "overall_confidence": 0.88,
  "missing_fields": [],
  "entities": [
    { "name": "公司名稱", "category": "Client", "industry": "產業類別", "matched_entity_id": "E-0001", "entity_match_confidence": 0.95 }
  ],
  "pipelines": [
    { "entity_name": "公司名稱", "stage": "提案", "est_value": 500000, "next_action_date": "YYYY-MM-DD", "status_summary": "一句話現況摘要" }
  ],
  "interactions": [
    { "entity_name": "公司名稱", "raw_transcript": "完整原始文字", "ai_key_insights": ["關鍵點1", "關鍵點2", "關鍵點3"], "sentiment": "Positive" }
  ],
  "actions": [
    { "entity_name": "公司名稱", "action_description": "任務描述", "action_date": "YYYY-MM-DD" }
  ]
}

未觸發的意圖其對應陣列設為 []。

## 邊界規則
- 公司名稱模糊：盡量用輸入中出現的名稱原樣輸出，同時嘗試與 Grounding Context 比對
- 月底 → 當月最後一天；下週X → 根據今天日期推算；過幾天 → 今天+3天
- 金額未提及：est_value 設為 null
- 新客戶判斷：有「新公司」「第一次」等詞觸發 CREATE_ENTITY，否則不觸發建立
- 一段話多家公司：各自產生對應物件`;

// ============================================================
// Entity Grounding 輔助函式
// ============================================================

/**
 * 從 Entity_Index sheet 讀取現有客戶名單，格式化為 Grounding Context 字串
 * 最多讀取 200 筆，避免 Prompt 過長
 * @returns {string} Grounding Context 純文字區塊
 */
function buildGroundingContext_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('Entity_Index');

  if (!sheet || sheet.getLastRow() <= 1) {
    return '\n\n## 現有客戶名單（Grounding Context）\n（目前無已知客戶）';
  }

  const maxRows = 200;
  const lastRow = sheet.getLastRow();
  const dataRows = Math.min(lastRow - 1, maxRows);

  // 讀取 Entity_ID(1)、Name(2)、Category(3)、Industry(4)
  const data = sheet.getRange(2, 1, dataRows, 4).getValues();

  const lines = data
    .filter(row => row[0] && row[1]) // 過濾空白列
    .map(row => `- ${row[0]} | ${row[1]} | ${row[2] || ''} | ${row[3] || ''}`);

  let context = '\n\n## 現有客戶名單（Grounding Context）\n' + lines.join('\n');

  if (lastRow - 1 > maxRows) {
    context += '\n（已截斷至前 200 筆）';
  }

  return context;
}

// ============================================================
// 公開函式：parseOnly（兩階段流程的第一階段）
// ============================================================

/**
 * 解析原始文字，回傳結構化 JSON，不執行任何 Sheets 寫入
 * 供前端透過 google.script.run 呼叫
 * @param {string} rawText - BD 輸入的原始文字
 * @returns {Object} NLU 解析結果，含 overall_confidence、matched_entity_id 等新欄位
 */
function parseOnly(rawText) {
  try {
    const groundingContext = buildGroundingContext_();
    const result = callGeminiNLU_(rawText, groundingContext);
    return { status: 'ok', data: result };
  } catch (error) {
    return { status: 'error', message: error.message };
  }
}

// ============================================================
// 內部函式：呼叫 Gemini API
// ============================================================

/**
 * 將 BD 的意識流文字送至 Gemini，回傳結構化 JSON
 * @param {string} rawText         - BD 輸入的原始文字
 * @param {string} groundingContext - 動態附加的 Entity 名單（可為空字串）
 * @returns {Object} parsedJSON - NLU 解析結果
 */
function callGeminiNLU_(rawText, groundingContext) {
  const apiKey = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  if (!apiKey) {
    throw new Error('請在 GAS Script Properties 中設定 GEMINI_API_KEY');
  }

  const today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  const userMessage = '今天的日期：' + today + '\n\n' + rawText;

  // 將 Grounding Context 附加在 system prompt 末尾
  const fullSystemPrompt = SYSTEM_PROMPT + (groundingContext || '');

  const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite-preview-06-17:generateContent?key=' + apiKey;

  const requestBody = {
    system_instruction: {
      parts: [{ text: fullSystemPrompt }]
    },
    contents: [{
      role: 'user',
      parts: [{ text: userMessage }]
    }],
    generationConfig: {
      response_mime_type: 'application/json',
      temperature: 0.1  // 低溫度確保 JSON 格式穩定
    }
  };

  const options = {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(requestBody),
    muteHttpExceptions: true
  };

  const response = UrlFetchApp.fetch(url, options);
  const responseCode = response.getResponseCode();
  const responseText = response.getContentText();

  if (responseCode !== 200) {
    throw new Error('Gemini API 錯誤 (' + responseCode + '): ' + responseText.substring(0, 200));
  }

  const responseJson = JSON.parse(responseText);
  const content = responseJson.candidates?.[0]?.content?.parts?.[0]?.text;

  if (!content) {
    throw new Error('Gemini 回應格式異常，無法取得解析結果');
  }

  return JSON.parse(content);
}

// ============================================================
// 測試函式（在 GAS 編輯器直接執行）
// ============================================================

/**
 * 測試 parseOnly 流程
 * 驗證回傳 JSON 包含 overall_confidence、missing_fields、matched_entity_id
 */
function testParseOnly() {
  const testInput = '今天跟台積那邊的窗口電話追蹤，對方說內部審核還要兩週，感覺還是正面的。';
  Logger.log('=== testParseOnly 開始 ===');
  Logger.log('輸入: ' + testInput);

  const result = parseOnly(testInput);
  Logger.log('回傳狀態: ' + result.status);

  if (result.status === 'ok') {
    Logger.log('overall_confidence: ' + result.data.overall_confidence);
    Logger.log('missing_fields: ' + JSON.stringify(result.data.missing_fields));
    Logger.log('intents: ' + JSON.stringify(result.data.intents));
    if (result.data.entities && result.data.entities.length > 0) {
      Logger.log('entities[0].matched_entity_id: ' + result.data.entities[0].matched_entity_id);
      Logger.log('entities[0].entity_match_confidence: ' + result.data.entities[0].entity_match_confidence);
    }
    Logger.log('完整 JSON:\n' + JSON.stringify(result.data, null, 2));
  } else {
    Logger.log('錯誤: ' + result.message);
  }

  Logger.log('=== testParseOnly 結束 ===');
}
