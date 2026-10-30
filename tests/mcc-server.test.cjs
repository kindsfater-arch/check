const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const { root, recommendation, geminiResponse, harness } = require('./helpers.cjs');

test('Все Apps Script-файлы и код веб-формы синтаксически корректны', () => {
  for (const name of fs.readdirSync(root).filter(name => name.endsWith('.gs'))) {
    new vm.Script(fs.readFileSync(path.join(root, name), 'utf8'), { filename: name });
  }
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  for (const match of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) new vm.Script(match[1]);
});

test('Веб-запрос возвращает MCC через существующую модель, не записывая чек', () => {
  const app = harness();
  const output = app.post({ action: 'suggest_mcc', description: '  Продуктовый супермаркет  ' });
  assert.deepEqual(output.json(), { ok: true, data: recommendation });
  assert.equal(output.type, 'application/json');
  assert.equal(app.requests.length, 1);
  const request = app.requests[0];
  assert.match(request.url, /gemini-2\.5-flash:generateContent$/);
  assert.equal(request.options.headers['x-goog-api-key'], 'test-key');
  assert.equal(request.payload.contents[0].parts[0].text, 'Продуктовый супермаркет');
  assert.match(request.payload.systemInstruction.parts[0].text, /Не путай MCC с ОКВЭД/);
  assert.equal(request.payload.generationConfig.responseMimeType, 'application/json');
  assert.equal(app.savedRows.length, 0);
});

test('Недостаточное описание возвращает уточняющий вопрос без придуманного кода', () => {
  const app = harness();
  const result = { mcc: '', description: '', reason: '', clarification: 'Какие товары продаёт магазин?' };
  app.setResponse(geminiResponse(result));
  assert.deepEqual(app.post({ action: 'suggest_mcc', description: 'Магазин' }).json(), { ok: true, data: result });
});

test('Пустой, слишком длинный и нетекстовый ввод не расходует запросы Gemini', () => {
  const app = harness();
  for (const description of ['', ' \n ', null, 42, {}, ['магазин'], 'я'.repeat(3001)]) {
    const output = app.post({ action: 'suggest_mcc', description }).json();
    assert.equal(output.ok, false);
    assert.equal(typeof output.error, 'string');
  }
  assert.equal(app.requests.length, 0);
  assert.equal(app.post({ action: 'suggest_mcc', description: 'я'.repeat(3000) }).json().ok, true);
});

test('Некорректный код, неполный и противоречивый ответ не выдаются за рекомендацию', () => {
  const app = harness();
  const invalidResults = [
    { ...recommendation, mcc: '541' },
    { ...recommendation, mcc: '0000' },
    { ...recommendation, mcc: 5411 },
    { ...recommendation, description: '' },
    { ...recommendation, reason: '' },
    { ...recommendation, clarification: 'Уточните ассортимент' },
    { mcc: '', description: '', reason: '', clarification: '' },
    { ...recommendation, description: 'я'.repeat(301) },
    null, [], {}
  ];
  for (const result of invalidResults) {
    app.setResponse(geminiResponse(result));
    assert.equal(app.post({ action: 'suggest_mcc', description: 'Продуктовый магазин' }).json().ok, false);
  }
});

test('Пустой, заблокированный, обрезанный ответ и ошибки API обрабатываются', () => {
  const app = harness();
  for (const response of [
    {}, null, { candidates: [] }, 'not json',
    { candidates: [{ finishReason: 'SAFETY' }] },
    { candidates: [{ finishReason: 'MAX_TOKENS' }] },
    { candidates: [{ finishReason: 'STOP', content: { parts: [] } }] },
    { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'broken json' }] } }] }
  ]) {
    app.setResponse(response);
    assert.equal(app.post({ action: 'suggest_mcc', description: 'Продуктовый магазин' }).json().ok, false);
  }
  for (const code of [400, 403, 429, 500]) {
    app.setResponse('private upstream details', code);
    const output = app.post({ action: 'suggest_mcc', description: 'Продуктовый магазин' }).json();
    assert.equal(output.ok, false);
    assert.doesNotMatch(output.error, /test-key|private upstream details/);
  }
});

test('Текст ответа объединяется из частей без служебных рассуждений', () => {
  const app = harness();
  const json = JSON.stringify(recommendation);
  app.setResponse({ candidates: [{ finishReason: 'STOP', content: { parts: [
    { text: 'private thoughts', thought: true },
    { text: '```json\n' + json.slice(0, 30) },
    { text: json.slice(30) + '\n```' }
  ] } }] });
  assert.deepEqual(app.post({ action: 'suggest_mcc', description: 'Продуктовый магазин' }).json().data, recommendation);
});

test('Распознавание фото и сохранение чека продолжают работать через прежние маршруты', () => {
  const app = harness();
  app.setResponse(geminiResponse({ inn: '1234567890', store_name: '  Магазин\nпродуктов  ' }));
  const output = app.post({ action: 'recognize_receipt', imageBase64: '/9j/AA==' }).json();
  assert.equal(output.ok, true);
  assert.equal(output.data.inn, '1234567890');
  assert.equal(output.data.store_name, 'Магазин продуктов');
  assert.equal(output.data.added_date, '30.10.2026');
  assert.equal(output.data.bank, null);
  assert.equal(app.requests[0].payload.contents[0].parts[1].inline_data.data, '/9j/AA==');
  assert.equal(app.post({ action: 'save_receipt', data: output.data }).json().ok, true);
  assert.equal(app.savedRows.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(app.savedRows[0])), ['web', 'web', output.data]);
});

test('Telegram-обновления по-прежнему передаются существующему обработчику', () => {
  const app = harness();
  let received;
  app.context.handleUpdate = update => { received = update; };
  const update = { message: { text: '/start' } };
  assert.equal(app.post(update).text, 'OK');
  assert.deepEqual(JSON.parse(JSON.stringify(received)), update);
  assert.equal(app.requests.length, 0);
});
