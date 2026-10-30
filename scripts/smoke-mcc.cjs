// Два реальных запроса к текущей модели. Ключ читается из Config.gs и не выводится.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

async function main() {
  const root = path.join(__dirname, '..');
  let payload;
  let apiResponse = { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify({
    mcc: '5411', description: 'Продуктовые магазины', reason: 'Продажа продуктов.', clarification: ''
  }) }] } }] };
  const context = vm.createContext({
    Logger: { log() {} },
    UrlFetchApp: { fetch(url, options) {
      payload = JSON.parse(options.payload);
      return { getResponseCode: () => 200, getContentText: () => JSON.stringify(apiResponse) };
    } }
  });
  for (const file of [process.env.MCC_CONFIG_PATH || path.join(root, 'Config.gs'), path.join(root, 'GeminiService.gs')]) {
    vm.runInContext(fs.readFileSync(file, 'utf8'), context, { filename: path.basename(file) });
  }
  const cases = [
    ['Розничный продуктовый супермаркет: продукты питания, напитки, молоко, овощи, бытовые мелочи. Основная выручка — от продуктов питания.', '5411'],
    ['Магазин', '']
  ];
  for (const [description, expected] of cases) {
    context.GeminiService.suggestMcc(description); // Получаем payload из самого сервиса.
    const response = await fetch(context.GEMINI_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': context.GEMINI_API_KEY },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(45000)
    });
    if (!response.ok) {
      const failure = await response.json().catch(() => ({}));
      const message = String(failure.error && failure.error.message || 'Ошибка API')
        .split(context.GEMINI_API_KEY).join('[REDACTED]');
      throw new Error('Gemini HTTP ' + response.status + ': ' + message);
    }
    apiResponse = await response.json();
    const result = context.GeminiService.suggestMcc(description); // Проверяем штатный разбор ответа.
    assert.equal(result.mcc, expected);
    console.log(JSON.stringify({ description, result }, null, 2));
  }
}

main().catch(error => {
  // Не печатаем URL или stack: они могут содержать служебные данные окружения.
  console.error('Live check failed: ' + error.message);
  process.exitCode = 1;
});
