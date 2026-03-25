/**
 * Conversational CRM — dispatcher.js
 * Phase 3: GAS Dispatcher (Web App)
 *
 * 功能：
 *   1. doPost 接收 Gemini NLU 輸出的 JSON
 *   2. 根據 intents 路由至對應的 Handler
 *   3. Fuzzy Matching 客戶名稱
 *   4. 寫入 Google Sheets（Entity / Pipeline / Interaction / Action）
 *   5. 串接 Google Calendar 建立行程，回填 GCal_Link
 *
 * 部署方式：
 *   GAS 編輯器 → 部署 → 新增部署 → Web 應用程式
 *   存取權限：「任何人」（或依安全需求調整）
 */

// ============================================================
// 設定常數
// ============================================================

// (Calendar 使用 getDefaultCalendar() ，不需要 CALENDAR_ID)

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
 * 接收 POST 請求：
 *   - 若含 raw_text：完整流程（NLU → Dispatch → 回傳簡潔摘要給 UI）
 *   - 若含 intents：直接 Dispatch（供 testDispatcher 使用）
 */
function doPost(e) {
    try {
        const payload = JSON.parse(e.postData.contents);

        if (payload.raw_text) {
            // ── 完整流程：raw text → Gemini NLU → Dispatch │
            const parsed = callGeminiNLU(payload.raw_text);
            const result = processPayload(parsed);
            const summary = buildSummary(result, parsed);
            return ContentService
                .createTextOutput(JSON.stringify({ status: 'success', summary: summary }))
                .setMimeType(ContentService.MimeType.JSON);
        } else {
            // ── 直接 Dispatch（供 testDispatcher 使用）──
            const result = processPayload(payload);
            return ContentService
                .createTextOutput(JSON.stringify({ status: 'success', result: result }))
                .setMimeType(ContentService.MimeType.JSON);
        }

    } catch (error) {
        return ContentService
            .createTextOutput(JSON.stringify({ status: 'error', message: error.message }))
            .setMimeType(ContentService.MimeType.JSON);
    }
}

/**
 * 前端透過 google.script.run 呼叫的主函式
 * 繞過 CORS 問題，直接在 GAS 服務器端執行完整流程
 * @param {string} rawText - BD 輸入的原始文字
 * @returns {Object} { status, summary } 或 { status, message }
 */
function processRawText(rawText) {
    try {
        const parsed = callGeminiNLU(rawText);
        const result = processPayload(parsed);
        const summary = buildSummary(result, parsed);
        return { status: 'success', summary: summary };
    } catch (error) {
        return { status: 'error', message: error.message };
    }
}

/**
 * 手動測試入口（可在 GAS 編輯器直接執行）
 * 將測試用的 JSON 貼在這裡
 */
function testDispatcher() {
    // 動態產生「7 天後」的日期，避免測試行程被埋在過去
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 7);
    const dueDateStr = Utilities.formatDate(futureDate, Session.getScriptTimeZone(), 'yyyy-MM-dd');

    const testPayload = {
        "intents": ["CREATE_ENTITY", "UPDATE_PIPELINE", "LOG_INTERACTION", "SCHEDULE_ACTION"],
        "entities": [
            { "name": "瑞昱半導體", "category": "Client", "industry": "IC 設計" }
        ],
        "pipelines": [
            {
                "entity_name": "瑞昱半導體",
                "stage": "規格",
                "est_value": 3000000,
                "next_action_date": "2025-04-11",
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
        "tasks": [
            {
                "ref_entity": "瑞昱半導體",
                "task_detail": "前往瑞昱半導體進行正式技術簡報",
                "due_date": dueDateStr
            }
        ]
    };

    const result = processPayload(testPayload);
    Logger.log(JSON.stringify(result, null, 2));
}

/**
 * 獨立 Calendar 診斷函式
 * 直接執行此函式副這個，不經過任何 Sheets 邏輯，確認 Calendar 权限與設定正確
 */
function testCalendar() {
    Logger.log('=== Calendar 診斷開始 ===');

    // Step 1: 取得預設日曆
    try {
        const calendar = CalendarApp.getDefaultCalendar();
        Logger.log('日曆名稱: ' + calendar.getName());
        Logger.log('日曆 ID: ' + calendar.getId());
    } catch (e) {
        Logger.log('[失敗] 無法取得日曆: ' + e.message);
        return;
    }

    // Step 2: 建立測試行程（使用「今天」避免日期問題）
    try {
        const calendar = CalendarApp.getDefaultCalendar();
        const today = new Date();

        Logger.log('將建立行程，日期: ' + Utilities.formatDate(today, Session.getScriptTimeZone(), 'yyyy-MM-dd'));

        const event = calendar.createAllDayEvent('[CRM TEST] 日曆診斷事件', today, {
            description: '此為診斷事件，可安全刪除'
        });

        Logger.log('行程建立成功! ID: ' + event.getId());
        Logger.log('行程標題: ' + event.getTitle());

        // 產生連結
        const calId = Session.getActiveUser().getEmail();
        const link = 'https://calendar.google.com/calendar/event?eid=' +
            Utilities.base64EncodeWebSafe(event.getId() + ' ' + calId).replace(/=/g, '');
        Logger.log('GCal Link: ' + link);

    } catch (e) {
        Logger.log('[失敗] 建立行程失敗: ' + e.message);
    }

    Logger.log('=== Calendar 診斷結束 ===');
}

// ============================================================
// 結果摘要生成器（供前端 UI 顯示）
// ============================================================

/**
 * 將 processPayload 的原始結果轉換為小木简潔格式
 * @param {Object} result    - processPayload 回傳的原始結果
 * @param {Object} parsed    - Gemini NLU 回傳的 JSON
 * @returns {Object} summary - 前端用简潔數據
 */
function buildSummary(result, parsed) {
    const entities = result.entities_created || [];
    const pipelines = result.pipelines_updated || [];
    const interactions = result.interactions_logged || [];
    const tasks = result.tasks_scheduled || [];

    // Calendar 行程明細（對應的 parsed task 資料）
    const calendarEvents = tasks
        .filter(t => t.gcal_link && !t.gcal_link.startsWith('ERROR'))
        .map(t => {
            // 找對應的原始 task 資料（取得 task_detail 與 due_date）
            const origTask = (parsed.tasks || []).find(pt => pt.ref_entity === t.ref_entity) || {};
            return {
                entity: t.ref_entity,
                detail: origTask.task_detail || t.task_id,
                date: origTask.due_date || '',
                link: t.gcal_link
            };
        });

    return {
        entities_created: entities.filter(e => e.action === 'CREATED').length,
        entities_skipped: entities.filter(e => e.action === 'SKIPPED').length,
        pipelines_created: pipelines.filter(p => p.action === 'CREATED').length,
        pipelines_updated: pipelines.filter(p => p.action === 'UPDATED').length,
        interactions: interactions.length,
        tasks: tasks.length,
        calendar_events: calendarEvents
    };
}

// ============================================================
// 核心路由引擎
// ============================================================

/**
 * 根據 intents 分派至對應的 Handler
 * @param {Object} payload - NLU 輸出的完整 JSON
 * @returns {Object} 各 handler 的執行結果
 */
function processPayload(payload) {
    const intents = payload.intents || [];
    const result = {
        entities_created: [],
        pipelines_updated: [],
        interactions_logged: [],
        tasks_scheduled: []
    };

    if (intents.includes('CREATE_ENTITY')) {
        result.entities_created = handleCreateEntities(payload.entities || []);
    }

    if (intents.includes('UPDATE_PIPELINE')) {
        result.pipelines_updated = handleUpdatePipelines(payload.pipelines || []);
    }

    if (intents.includes('LOG_INTERACTION')) {
        result.interactions_logged = handleLogInteractions(payload.interactions || []);
    }

    if (intents.includes('SCHEDULE_ACTION')) {
        result.tasks_scheduled = handleScheduleActions(payload.tasks || []);
    }

    return result;
}

// ============================================================
// Handler: CREATE_ENTITY
// ============================================================

/**
 * 建立新客戶/夥伴
 * 若名稱已存在（Fuzzy Match），跳過建立並回傳提示
 */
function handleCreateEntities(entities) {
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
function handleUpdatePipelines(pipelines) {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName('Strategic_Pipeline');
    const results = [];

    pipelines.forEach(pipeline => {
        // 1. Fuzzy Match entity name
        let resolvedName = fuzzyMatchEntity(pipeline.entity_name);

        // 2. [優化] 若 Entity 不存在，則自動建立 (Proactive Discovery)
        if (!resolvedName) {
            Logger.log('[Dispatcher] 偵測到新 Entity: ' + pipeline.entity_name + '，自動建立中...');
            handleCreateEntities([{ name: pipeline.entity_name, category: 'Client' }]);
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
 * 記錄互動日誌
 */
function handleLogInteractions(interactions) {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName('Interaction_Timeline');
    const results = [];

    interactions.forEach(interaction => {
        let resolvedName = fuzzyMatchEntity(interaction.entity_name);

        // [優化] 自動補齊 Entity
        if (!resolvedName) {
            handleCreateEntities([{ name: interaction.entity_name, category: 'Client' }]);
            resolvedName = interaction.entity_name;
        }

        const newId = getNextLogId();
        const now = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');

        // 將 key insights 陣列轉為 bullet points 文字
        const insights = (interaction.ai_key_insights || [])
            .map(point => '• ' + point)
            .join('\n');

        sheet.appendRow([
            newId,
            now,
            resolvedName,
            interaction.raw_transcript || '',
            insights,
            interaction.sentiment || 'Neutral',
            'System' // Reporter
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
 * 建立 Google Calendar 行程，並將連結回填至 Action_Backlog
 */
function handleScheduleActions(tasks) {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName('Action_Backlog');
    const results = [];

    tasks.forEach(task => {
        let resolvedName = fuzzyMatchEntity(task.ref_entity);

        // [優化] 自動補齊 Entity
        if (!resolvedName) {
            handleCreateEntities([{ name: task.ref_entity, category: 'Client' }]);
            resolvedName = task.ref_entity;
        }

        const newId = getNextTaskId();

        // --- 建立 Google Calendar 全天行程 ---
        let gcalLink = '';
        try {
            Logger.log('[Calendar] 開始建立行程，對象: ' + resolvedName);

            const calendar = CalendarApp.getDefaultCalendar();
            Logger.log('[Calendar] 日曆: ' + calendar.getName());

            const parts = task.due_date.split('-');
            const dueDate = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
            Logger.log('[Calendar] 行程日期: ' + Utilities.formatDate(dueDate, Session.getScriptTimeZone(), 'yyyy-MM-dd'));

            const eventTitle = '[CRM] ' + resolvedName + ' — ' + task.task_detail;
            Logger.log('[Calendar] 行程標題: ' + eventTitle);

            const event = calendar.createAllDayEvent(eventTitle, dueDate, {
                description: '由 Conversational CRM 自動建立\n\n'
                    + '客戶/夥伴：' + resolvedName + '\n'
                    + '任務：' + task.task_detail
            });
            Logger.log('[Calendar] 行程建立成功! ID: ' + event.getId());

            const rawId = event.getId();
            const calId = Session.getActiveUser().getEmail();
            gcalLink = 'https://calendar.google.com/calendar/event?eid=' +
                Utilities.base64EncodeWebSafe(rawId + ' ' + calId).replace(/=/g, '');
            Logger.log('[Calendar] GCal Link: ' + gcalLink);

        } catch (calError) {
            Logger.log('[Calendar] 建立失敗! 錯誤: ' + calError.message);
            Logger.log('[Calendar] Stack: ' + calError.stack);
            gcalLink = 'ERROR: ' + calError.message;
        }

        // --- 寫入 Action_Backlog ---
        sheet.appendRow([
            newId,
            resolvedName,
            task.task_detail,
            task.due_date,
            gcalLink,
            'System' // Reporter
        ]);

        results.push({
            ref_entity: resolvedName,
            action: 'SCHEDULED',
            task_id: newId,
            gcal_link: gcalLink
        });
    });

    return results;
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
