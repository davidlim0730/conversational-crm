/**
 * Conversational CRM — dispatcher.js
 * Sprint 2+3: GAS Dispatcher (Web App)
 *
 * 功能：
 *   1. doPost 接收前端請求，依 action 路由
 *   2. parseOnly  → 只呼叫 NLU，不寫入（由 gemini_nlu.js 處理）
 *   3. confirmWrite → 接受使用者確認資料，寫入 Sheets + Slack 通知
 *   4. retrySlack   → 重試 Slack 通知失敗的任務
 *   5. Fuzzy Matching 客戶名稱
 *
 * 部署方式：
 *   GAS 編輯器 → 部署 → 新增部署 → Web 應用程式
 *   存取權限：「任何人」（或依安全需求調整）
 */

// ============================================================
// Web App 入口
// ============================================================

/**
 * 提供前端 HTML 介面
 * GAS 部署後，開啟 Web App URL 即可看到輸入介面
 */
function doGet() {
    return HtmlService.createHtmlOutputFromFile('frontend')
        .setTitle('Conversational CRM — 3 分鐘儀式')
        .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/**
 * 接收 POST 請求，依 action 欄位路由：
 *   action: "parseOnly"    → 呼叫 NLU，不寫入，回傳解析 JSON
 *   action: "confirmWrite" → 接受確認資料，寫入 Sheets + Slack
 *   action: "retrySlack"   → 重試指定任務的 Slack 通知
 */
function doPost(e) {
    try {
        const payload = JSON.parse(e.postData.contents);
        const action = payload.action;

        if (action === 'parseOnly') {
            const result = parseOnly(payload.raw_text);
            return ContentService
                .createTextOutput(JSON.stringify(result))
                .setMimeType(ContentService.MimeType.JSON);

        } else if (action === 'confirmWrite') {
            const result = confirmWrite(payload.confirmedData);
            return ContentService
                .createTextOutput(JSON.stringify(result))
                .setMimeType(ContentService.MimeType.JSON);

        } else if (action === 'retrySlack') {
            const result = retrySlack(payload.actionData);
            return ContentService
                .createTextOutput(JSON.stringify(result))
                .setMimeType(ContentService.MimeType.JSON);

        } else {
            return ContentService
                .createTextOutput(JSON.stringify({ status: 'error', message: '未知的 action: ' + action }))
                .setMimeType(ContentService.MimeType.JSON);
        }

    } catch (error) {
        return ContentService
            .createTextOutput(JSON.stringify({ status: 'error', message: error.message }))
            .setMimeType(ContentService.MimeType.JSON);
    }
}

/**
 * 接受使用者確認後的 NLU 資料，執行 Sheets 寫入 + Slack 通知
 * 供前端透過 google.script.run 呼叫（兩階段流程第二階段）
 * @param {Object} confirmedData - NLU JSON（含 intents、entities 等）+ edit_log
 * @returns {Object} { status: 'ok'|'partial_success'|'error', written, slackSent, ... }
 */
function confirmWrite(confirmedData) {
    try {
        const result = processPayload_(confirmedData);
        return {
            status: result.slackFailed ? 'partial_success' : 'ok',
            written: result.written,
            slackSent: !result.slackFailed,
            slackError: result.slackError || null
        };
    } catch (error) {
        return { status: 'error', message: error.message };
    }
}

/**
 * 重試 Slack 通知失敗的任務
 * 供前端透過 google.script.run 呼叫
 * @param {Object} actionData - { task_id, entity_name, action_description, action_date }
 * @returns {Object} { status: 'ok'|'error', message? }
 */
function retrySlack(actionData) {
    try {
        const slackResult = sendConfirmation(actionData);
        if (!slackResult.success) {
            return { status: 'error', message: slackResult.error };
        }

        // 更新 Action_Backlog：Slack_Notified=true、Slack_Notified_At=現在
        const ss = SpreadsheetApp.getActiveSpreadsheet();
        const sheet = ss.getSheetByName('Action_Backlog');
        if (sheet && actionData.task_id) {
            const data = sheet.getRange(2, 1, Math.max(sheet.getLastRow() - 1, 1), 1).getValues();
            for (let i = 0; i < data.length; i++) {
                if (data[i][0] === actionData.task_id) {
                    const row = i + 2;
                    const now = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');
                    sheet.getRange(row, 6).setValue(true);   // Slack_Notified
                    sheet.getRange(row, 7).setValue(now);    // Slack_Notified_At
                    break;
                }
            }
        }

        return { status: 'ok' };
    } catch (error) {
        return { status: 'error', message: error.message };
    }
}

/**
 * 手動測試入口：confirmWrite 流程（可在 GAS 編輯器直接執行）
 */
function testDispatcher() {
    // 動態產生「7 天後」的日期
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 7);
    const dueDateStr = Utilities.formatDate(futureDate, Session.getScriptTimeZone(), 'yyyy-MM-dd');

    const testPayload = {
        "intents": ["CREATE_ENTITY", "UPDATE_PIPELINE", "LOG_INTERACTION", "SCHEDULE_ACTION"],
        "overall_confidence": 0.90,
        "missing_fields": [],
        "entities": [
            { "name": "瑞昱半導體", "category": "Client", "industry": "IC 設計", "matched_entity_id": null, "entity_match_confidence": 0 }
        ],
        "pipelines": [
            {
                "entity_name": "瑞昱半導體",
                "stage": "規格",
                "est_value": 3000000,
                "next_action_date": dueDateStr,
                "status_summary": "採購副總對 AI 質檢方案感興趣，內部評估預算中"
            }
        ],
        "interactions": [
            {
                "entity_name": "瑞昱半導體",
                "raw_transcript": "今天下午去拜訪了一家新公司叫瑞昱半導體...",
                "ai_key_insights": [
                    "採購副總對 AI 質檢方案有高度興趣",
                    "初步預估商機金額約 300 萬",
                    "客戶內部已啟動預算評估流程"
                ],
                "sentiment": "Positive"
            }
        ],
        "actions": [
            {
                "entity_name": "瑞昱半導體",
                "action_description": "前往瑞昱半導體進行正式技術簡報",
                "action_date": dueDateStr
            }
        ],
        "edit_log": []
    };

    Logger.log('=== testDispatcher (confirmWrite) 開始 ===');
    const result = confirmWrite(testPayload);
    Logger.log(JSON.stringify(result, null, 2));
    Logger.log('=== testDispatcher 結束 ===');
}

/**
 * 手動測試 confirmWrite 並驗證 Slack 通知
 */
function testConfirmWrite() {
    testDispatcher();
}


// ============================================================
// 核心路由引擎（內部）
// ============================================================

/**
 * 根據 intents 分派至對應的 Handler，回傳寫入結果與 Slack 狀態
 * @param {Object} confirmedData - 使用者確認後的 NLU JSON（含 edit_log）
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
        const scheduleResult = handleScheduleActions_(confirmedData.actions || []);
        written.actions_scheduled = scheduleResult.results;
        if (scheduleResult.slackFailed) {
            slackFailed = true;
            slackError = scheduleResult.slackError;
        }
    }

    return { written, slackFailed, slackError };
}

// ============================================================
// Handler: CREATE_ENTITY
// ============================================================

/**
 * 建立新客戶/夥伴
 * 若名稱已存在（Fuzzy Match），跳過建立並回傳提示
 */
function handleCreateEntities_(entities) {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName('Entity_Index');
    const results = [];

    entities.forEach(entity => {
        // 檢查是否已存在（Fuzzy Match）
        const match = fuzzyMatchEntity(entity.name);
        if (match) {
            results.push({
                name: match, // 回傳正式名稱
                action: 'SKIPPED',
                reason: '已存在'
            });
            return;
        }

        const newId = getNextEntityId();
        const now = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');

        sheet.appendRow([
            newId,
            entity.name,
            entity.category || 'Client',
            entity.industry || '',
            now,
            'System' // Reporter 欄位 (Phase 2 預留)
        ]);

        results.push({
            name: entity.name,
            action: 'CREATED',
            entity_id: newId
        });
    });

    return results;
}

// ============================================================
// Handler: UPDATE_PIPELINE
// ============================================================

/**
 * 更新案件進度（若不存在則新建）
 * 使用 Fuzzy Match 找到正確的 Entity Name
 */
function handleUpdatePipelines_(pipelines) {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName('Strategic_Pipeline');
    const results = [];

    pipelines.forEach(pipeline => {
        // 1. Fuzzy Match entity name
        let resolvedName = fuzzyMatchEntity(pipeline.entity_name);

        // 2. [優化] 若 Entity 不存在，則自動建立 (Proactive Discovery)
        if (!resolvedName) {
            Logger.log('[Dispatcher] 偵測到新 Entity: ' + pipeline.entity_name + '，自動建立中...');
            handleCreateEntities_([{ name: pipeline.entity_name, category: 'Client' }]);
            resolvedName = pipeline.entity_name;
        }

        // 3. 搜尋既有記錄
        const existingRow = findRowByEntityName(sheet, resolvedName);

        if (existingRow) {
            // 更新既有記錄
            const row = existingRow.row;
            if (pipeline.stage) sheet.getRange(row, 3).setValue(pipeline.stage);
            if (pipeline.est_value !== null && pipeline.est_value !== undefined) {
                sheet.getRange(row, 4).setValue(pipeline.est_value);
            }
            if (pipeline.next_action_date) sheet.getRange(row, 5).setValue(pipeline.next_action_date);
            if (pipeline.status_summary) sheet.getRange(row, 6).setValue(pipeline.status_summary);

            // 更新最後更新人 (Phase 2)
            sheet.getRange(row, 7).setValue('System');

            results.push({
                entity_name: resolvedName,
                action: 'UPDATED',
                project_id: existingRow.id
            });
        } else {
            // 新建記錄
            const newId = getNextProjectId();
            sheet.appendRow([
                newId,
                resolvedName,
                pipeline.stage || '',
                pipeline.est_value || '',
                pipeline.next_action_date || '',
                pipeline.status_summary || '',
                'System' // Reporter/Owner
            ]);

            results.push({
                entity_name: resolvedName,
                action: 'CREATED',
                project_id: newId
            });
        }
    });

    return results;
}

// ============================================================
// Handler: LOG_INTERACTION
// ============================================================

/**
 * 記錄互動日誌，第 8 欄寫入 Edit_Log JSON 字串
 * @param {Array} interactions - 互動陣列
 * @param {Array} editLog      - 使用者在 EDITING 狀態的修改記錄
 */
function handleLogInteractions_(interactions, editLog) {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName('Interaction_Timeline');
    const results = [];
    const editLogStr = (editLog && editLog.length > 0) ? JSON.stringify(editLog) : '';

    interactions.forEach(interaction => {
        let resolvedName = fuzzyMatchEntity(interaction.entity_name);

        // [優化] 自動補齊 Entity
        if (!resolvedName) {
            handleCreateEntities_([{ name: interaction.entity_name, category: 'Client' }]);
            resolvedName = interaction.entity_name;
        }

        const newId = getNextLogId();
        const now = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');

        // 將 key insights 陣列轉為 bullet points 文字
        const insights = (interaction.ai_key_insights || [])
            .map(point => '• ' + point)
            .join('\n');

        // 第 8 欄（Edit_Log）寫入 JSON 字串
        sheet.appendRow([
            newId,
            now,
            resolvedName,
            interaction.raw_transcript || '',
            insights,
            interaction.sentiment || 'Neutral',
            'System',   // Reporter
            editLogStr  // Edit_Log（col 8）
        ]);

        results.push({
            entity_name: resolvedName,
            action: 'LOGGED',
            log_id: newId
        });
    });

    return results;
}

// ============================================================
// Handler: SCHEDULE_ACTION
// ============================================================

/**
 * 寫入 Action_Backlog（新欄位：Slack_Notified/Slack_Notified_At/Status），
 * 並呼叫 sendConfirmation() 發送 Slack 通知
 * @param {Array} actions - actions 陣列（新格式：entity_name、action_description、action_date）
 * @returns {Object} { results, slackFailed, slackError }
 */
function handleScheduleActions_(actions) {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName('Action_Backlog');
    const results = [];
    let slackFailed = false;
    let slackError = null;

    actions.forEach(action => {
        let resolvedName = fuzzyMatchEntity(action.entity_name);

        // [優化] 自動補齊 Entity
        if (!resolvedName) {
            handleCreateEntities_([{ name: action.entity_name, category: 'Client' }]);
            resolvedName = action.entity_name;
        }

        const newId = getNextTaskId();

        // --- 寫入 Action_Backlog（新 Schema：8 欄，無 GCal_Link）---
        sheet.appendRow([
            newId,
            resolvedName,
            action.action_description || '',
            action.action_date || '',
            'System',  // Reporter
            false,     // Slack_Notified（col 6）
            '',        // Slack_Notified_At（col 7）
            'pending'  // Status（col 8）
        ]);

        // --- 呼叫 Slack 通知 ---
        const actionData = {
            task_id: newId,
            entity_name: resolvedName,
            action_description: action.action_description || '',
            action_date: action.action_date || ''
        };
        const slackResult = sendConfirmation(actionData);

        if (slackResult.success) {
            // 更新 Slack_Notified=true、Slack_Notified_At
            const now = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');
            const lastRow = sheet.getLastRow();
            sheet.getRange(lastRow, 6).setValue(true);
            sheet.getRange(lastRow, 7).setValue(now);
        } else {
            Logger.log('[Slack] 通知失敗（task_id: ' + newId + '）: ' + slackResult.error);
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

// ============================================================
// Fuzzy Matching 引擎
// ============================================================

/**
 * 在 Entity_Index 中以 Fuzzy Match 搜尋最接近的名稱
 * 策略：containment matching（互相包含即視為匹配）
 *
 * @param {string} inputName - 使用者輸入的名稱
 * @returns {string|null} 匹配到的正式名稱，或 null
 */
function fuzzyMatchEntity(inputName) {
    if (!inputName) return null;

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName('Entity_Index');

    if (!sheet || sheet.getLastRow() <= 1) return null;

    const names = sheet.getRange(2, 2, sheet.getLastRow() - 1, 1).getValues().flat();
    const normalized = inputName.trim().toLowerCase();

    // 1. 精確匹配（不分大小寫）
    for (const name of names) {
        if (typeof name === 'string' && name.toLowerCase() === normalized) {
            return name;
        }
    }

    // 2. 包含匹配（input 包含 DB 值，或 DB 值包含 input）
    let bestMatch = null;
    let bestScore = 0;

    for (const name of names) {
        if (typeof name !== 'string' || name === '') continue;
        const dbNormalized = name.toLowerCase();

        if (dbNormalized.includes(normalized) || normalized.includes(dbNormalized)) {
            // 使用較長字串的長度比作為分數，越相近分數越高
            const score = Math.min(normalized.length, dbNormalized.length) /
                Math.max(normalized.length, dbNormalized.length);
            if (score > bestScore) {
                bestScore = score;
                bestMatch = name;
            }
        }
    }

    // 閾值：至少 50% 相似度
    if (bestMatch && bestScore >= 0.5) {
        return bestMatch;
    }

    return null;
}

// ============================================================
// 通用工具函式
// ============================================================

/**
 * 在指定 Sheet 中，根據 Entity_Name（第 2 欄）搜尋列號
 * @param {Sheet} sheet - Google Sheets Sheet 物件
 * @param {string} entityName - 要搜尋的名稱
 * @returns {Object|null} { row: number, id: string } 或 null
 */
function findRowByEntityName(sheet, entityName) {
    if (!sheet || sheet.getLastRow() <= 1) return null;

    const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).getValues();

    for (let i = 0; i < data.length; i++) {
        if (data[i][1] === entityName) {
            return { row: i + 2, id: data[i][0] };
        }
    }
    return null;
}
