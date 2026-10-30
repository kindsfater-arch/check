// Создайте Config.gs в Apps Script и заполните значения на сервере.
// В существующем проекте сохраните его действующую конфигурацию.
var BOT_TOKEN = 'YOUR_TELEGRAM_BOT_TOKEN';
var GEMINI_API_KEY = 'YOUR_GEMINI_API_KEY';
var SHEET_ID = 'YOUR_GOOGLE_SHEET_ID';
var WEBAPP_URL = 'YOUR_EXISTING_WEBAPP_OR_WORKER_URL';

var FIELD_LABELS = {
  inn: 'ИНН',
  store_name: 'Название магазина',
  legal_name: 'Юр. название',
  receipt_date: 'Дата чека',
  added_date: 'Дата добавления',
  address: 'Адрес',
  bank: 'Банк',
  comment: 'Комментарий'
};
var FIELD_KEYS = Object.keys(FIELD_LABELS);
var REPORT_EMAIL = 'YOUR_REPORT_EMAIL';
var GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';
var TELEGRAM_API_URL = 'https://api.telegram.org/bot' + BOT_TOKEN;
var TELEGRAM_FILE_URL = 'https://api.telegram.org/file/bot' + BOT_TOKEN;
