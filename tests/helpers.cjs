const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const recommendation = {
  mcc: '5411',
  description: 'Продуктовые магазины и супермаркеты',
  reason: 'Основная выручка приходится на розничную продажу продуктов питания.',
  clarification: ''
};

function geminiResponse(data) {
  return { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(data) }] } }] };
}

function harness() {
  const requests = [];
  const savedRows = [];
  let response = geminiResponse(recommendation);
  let status = 200;
  const context = vm.createContext({
    GEMINI_API_URL: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',
    GEMINI_API_KEY: 'test-key',
    FIELD_KEYS: ['inn', 'store_name', 'legal_name', 'receipt_date', 'added_date', 'address', 'bank', 'comment'],
    Logger: { log() {} },
    Utilities: {
      base64Encode: bytes => Buffer.from(bytes).toString('base64'),
      base64Decode: value => Array.from(Buffer.from(value, 'base64')),
      formatDate: () => '30.10.2026'
    },
    Session: { getScriptTimeZone: () => 'Europe/Kaliningrad' },
    UrlFetchApp: {
      fetch(url, options) {
        requests.push({ url, options, payload: JSON.parse(options.payload) });
        return {
          getResponseCode: () => status,
          getContentText: () => typeof response === 'string' ? response : JSON.stringify(response)
        };
      }
    },
    ContentService: {
      MimeType: { JSON: 'application/json', TEXT: 'text/plain' },
      createTextOutput(text) { return { text, setMimeType(type) { this.type = type; return this; } }; }
    },
    SheetsService: { saveToSheets: (...args) => savedRows.push(args) }
  });
  for (const name of ['GeminiService.gs', 'Code.gs']) {
    vm.runInContext(fs.readFileSync(path.join(root, name), 'utf8'), context, { filename: name });
  }
  return {
    context, requests, savedRows,
    setResponse(data, code = 200) { response = data; status = code; },
    post(body) {
      const output = context.doPost({ postData: { contents: JSON.stringify(body) } });
      return { ...output, json: () => JSON.parse(output.text) };
    }
  };
}

module.exports = { root, recommendation, geminiResponse, harness };
