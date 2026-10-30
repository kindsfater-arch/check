// SheetsService.gs — сохранение данных в Google Sheets

var SheetsService = (function () {

  var HEADERS = ['userId', 'userName', 'Timestamp'].concat(FIELD_KEYS.map(function (k) { return FIELD_LABELS[k]; }));

  // Получить или создать лист «Receipts» с заголовками
  function _getSheet() {
    var ss = SpreadsheetApp.openById(SHEET_ID);
    var sheet = ss.getSheetByName('Receipts');
    if (!sheet) {
      sheet = ss.insertSheet('Receipts');
      sheet.appendRow(HEADERS);
      // Заморозить первую строку
      sheet.setFrozenRows(1);
      // Жирный заголовок
      sheet.getRange(1, 1, 1, HEADERS.length).setFontWeight('bold');
    }
    return sheet;
  }

  // Добавить строку с данными чека
  function saveToSheets(userId, userName, data) {
    var sheet = _getSheet();
    var timestamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd.MM.yyyy HH:mm:ss');
    var row = [userId, userName, timestamp].concat(FIELD_KEYS.map(function (k) { return data[k] || ''; }));
    sheet.appendRow(row);
  }

  // Запустить вручную из редактора GAS для проверки записи
  function testWrite() {
    var testData = {};
    FIELD_KEYS.forEach(function (k) { testData[k] = 'TEST_' + k; });
    saveToSheets('test_user', 'test_user', testData);
    Logger.log('testWrite: строка записана в таблицу ' + SHEET_ID);
  }

  return { saveToSheets: saveToSheets, testWrite: testWrite };
})();
