/**
 * Conversational CRM
 * 初始化 Google Sheets 四張核心數據表
 */
function initSheetStructure() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  
  const tables = [
    {
      name: 'Entity_Index',
      headers: ['Entity_ID', 'Name', 'Category', 'Industry', 'Created_At']
    },
    {
      name: 'Strategic_Pipeline',
      headers: ['Project_ID', 'Entity_Name', 'Stage', 'Est_Value', 'Next_Action_Date', 'Status_Summary']
    },
    {
      name: 'Interaction_Timeline',
      headers: ['Log_ID', 'Timestamp', 'Entity_Name', 'Raw_Transcript', 'AI_Key_Insights', 'Sentiment']
    },
    {
      name: 'Action_Backlog',
      headers: ['Task_ID', 'Ref_Entity', 'Task_Detail', 'Due_Date', 'GCal_Link']
    }
  ];

  tables.forEach(table => {
    let sheet = ss.getSheetByName(table.name);
    if (!sheet) {
      sheet = ss.insertSheet(table.name);
    }
    sheet.clear();
    sheet.getRange(1, 1, 1, table.headers.length).setValues([table.headers]);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, table.headers.length).setFontWeight("bold").setBackground("#f3f3f3");
  });

  SpreadsheetApp.getUi().alert('✅ 四張核心表已成功初始化並格式化！');
}
