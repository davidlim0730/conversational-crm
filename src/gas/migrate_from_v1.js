/**
 * migrate_from_v1.js
 * 將舊版 "Satellite Sales OS" 資料一次性匯入新版四張表
 * 執行方式：在 GAS 編輯器選 migrateFromV1 → 執行（只需執行一次）
 */

function migrateFromV1() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  // ── Entity_Index ──────────────────────────────────────────────
  const entityData = [
    ['E-0001', '裕珍馨',                    'Client', '未分類', '2026-03-10', 'Venus'],
    ['E-0002', '麗嬰國際',                  'Client', '未分類', '2026-03-10', 'Ellie'],
    ['E-0003', 'MKS | 阿托科技 Atotech',   'Client', '未分類', '2026-03-10', 'Venus'],
    ['E-0004', '農遊超市',                  'Client', '未分類', '2026-03-10', 'Abeni'],
    ['E-0005', '牧騰生技',                  'Client', '未分類', '2026-03-10', 'Rita'],
    ['E-0006', '普羅品牌',                  'Client', '未分類', '2026-03-10', 'Ellie'],
    ['E-0007', '台灣禮來',                  'Client', '未分類', '2026-03-10', 'Rita'],
    ['E-0008', 'Electrolux 伊萊克斯',      'Client', '未分類', '2026-03-10', 'David'],
    ['E-0009', '阿瘦皮鞋（足健康）',       'Client', '未分類', '2026-03-10', 'Venus'],
    ['E-0010', '台積電',                    'Client', '未分類', '2026-03-28', 'David Lin'],
  ];

  // ── Strategic_Pipeline ───────────────────────────────────────
  const pipelineData = [
    ['P-2026-0001', '裕珍馨',               '尋商', 0,        '',           '', 'AI_Agent'],
    ['P-2026-0002', '麗嬰國際',             '規格', 530000,   '',           '', 'David Lin'],
    ['P-2026-0003', 'MKS | 阿托科技 Atotech', '尋商', 250000, '2026-03-21', '', 'AI_Agent'],
    ['P-2026-0004', '農遊超市',             '尋商', 210000,   '',           '', 'David Lin'],
    ['P-2026-0005', '牧騰生技',             '尋商', 0,        '',           '', 'David Lin'],
    ['P-2026-0006', '普羅品牌',             '尋商', 0,        '',           '', 'David Lin'],
    ['P-2026-0007', '台灣禮來',             '尋商', 0,        '',           '', 'Oscar Ho'],
    ['P-2026-0008', 'Electrolux 伊萊克斯', '尋商', 0,        '',           '', 'David'],
    ['P-2026-0009', '阿瘦皮鞋（足健康）',  '尋商', 0,        '',           '', 'David Lin'],
    ['P-2026-0010', '裕珍馨',               '尋商', 0,        '2026-03-31', '', 'AI_Agent'],
    ['P-2026-0011', '台積電',               '規格', 5000000,  '2026-04-01', '', 'AI_Agent'],
  ];

  // ── Interaction_Timeline ──────────────────────────────────────
  // 略過 Raw_Transcript 為空或 '0' 的系統自動記錄
  const timelineData = [
    ['L-00001', '2026-03-10 09:59:38', '裕珍馨',               '約 3/18（三） 提案會議（ w/ 營業部主管）',                                  '歷史資料匯入', 'Neutral', 'David Lin', ''],
    ['L-00002', '2026-03-10 09:59:38', '麗嬰國際',             '2/13 提供簡報給客戶 & 約過年後線上會議',                                   '歷史資料匯入', 'Neutral', 'David Lin', ''],
    ['L-00003', '2026-03-10 09:59:40', 'MKS | 阿托科技 Atotech', '約 3/17 （二）實體會議 demo & 議價',                                   '歷史資料匯入', 'Neutral', 'David Lin', ''],
    ['L-00004', '2026-03-10 09:59:41', '農遊超市',             '3/6 客戶回覆，希望我們協助評估 rezio(票券電商模組系統) 串接議題後，再往下推進', '歷史資料匯入', 'Neutral', 'David Lin', ''],
    ['L-00005', '2026-03-10 09:59:42', '牧騰生技',             '第一階段僅購買 CRM 系統',                                                  '歷史資料匯入', 'Neutral', 'David Lin', ''],
    ['L-00006', '2026-03-10 09:59:42', '普羅品牌',             'Budget：預算問題',                                                         '歷史資料匯入', 'Neutral', 'David Lin', ''],
    ['L-00007', '2026-03-10 09:59:43', '台灣禮來',             'Need：年提選商未入選',                                                     '歷史資料匯入', 'Neutral', 'Oscar Ho',  ''],
    ['L-00008', '2026-03-10 09:59:44', 'Electrolux 伊萊克斯', '對 GEO 話題有興趣',                                                       '歷史資料匯入', 'Neutral', 'David',     ''],
    ['L-00009', '2026-03-10 09:59:46', '阿瘦皮鞋（足健康）',  '暫以一週一次頻率跟進',                                                     '歷史資料匯入', 'Neutral', 'David Lin', ''],
  ];

  // ── 寫入函式 ─────────────────────────────────────────────────
  function appendRows(sheetName, rows) {
    const sheet = ss.getSheetByName(sheetName);
    if (!sheet) {
      console.log('❌ 找不到工作表：' + sheetName);
      return;
    }
    if (rows.length === 0) return;
    sheet.getRange(2, 1, rows.length, rows[0].length).setValues(rows);
    console.log('✅ ' + sheetName + '：寫入 ' + rows.length + ' 筆');
  }

  appendRows('Entity_Index',          entityData);
  appendRows('Strategic_Pipeline',    pipelineData);
  appendRows('Interaction_Timeline',  timelineData);

  console.log('🎉 Migration 完成！');
}
