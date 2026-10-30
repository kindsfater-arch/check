const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { JSDOM } = require('jsdom');
const { root, recommendation, harness } = require('./helpers.cjs');

function page(fetchImpl) {
  const requests = [];
  const dom = new JSDOM(fs.readFileSync(path.join(root, 'index.html'), 'utf8'), {
    runScripts: 'dangerously',
    url: 'https://checkscan.test/',
    beforeParse(window) {
      window.HTMLElement.prototype.scrollIntoView = function () {};
      window.fetch = async (url, options) => {
        requests.push({ url, options, body: JSON.parse(options.body) });
        if (fetchImpl) return fetchImpl(url, options);
        return { ok: true, json: async () => ({ ok: true, data: recommendation }) };
      };
    }
  });
  const $ = id => dom.window.document.getElementById(id);
  return {
    dom, $, requests,
    input(text) {
      $('mccDescription').value = text;
      $('mccDescription').dispatchEvent(new dom.window.Event('input'));
    },
    submit() {
      return $('mccForm').onsubmit(new dom.window.Event('submit', { cancelable: true }));
    }
  };
}

test('Кнопка раскрывает форму, переводит фокус в текст и работает без фото', async t => {
  const app = page();
  t.after(() => app.dom.window.close());
  assert.equal(app.$('mccPanel').hidden, true);
  app.$('mccToggleBtn').click();
  assert.equal(app.$('mccPanel').hidden, false);
  assert.equal(app.$('mccToggleBtn').getAttribute('aria-expanded'), 'true');
  assert.equal(app.dom.window.document.activeElement, app.$('mccDescription'));
  app.input('  Продуктовый супермаркет  ');
  await app.submit();
  assert.deepEqual(app.requests[0].body, { action: 'suggest_mcc', description: 'Продуктовый супермаркет' });
  assert.match(app.requests[0].options.headers['Content-Type'], /^text\/plain/);
  assert.equal(app.$('mccResult').hidden, false);
  assert.equal(app.$('mccCode').textContent, '5411');
  assert.equal(app.$('mccCategory').textContent, recommendation.description);
  assert.equal(app.$('mccReason').textContent, recommendation.reason);
  assert.equal(app.$('mccSubmitBtn').disabled, false);
  assert.equal(app.$('fields').style.display, '');
  app.$('mccToggleBtn').click();
  assert.equal(app.$('mccPanel').hidden, true);
});

test('Во время запроса повторная отправка блокируется, после ответа ввод восстанавливается', async t => {
  let resolveResponse;
  const app = page(() => new Promise(resolve => { resolveResponse = resolve; }));
  t.after(() => app.dom.window.close());
  app.input('Продуктовый магазин');
  const pending = app.submit();
  assert.equal(app.$('mccSubmitBtn').disabled, true);
  assert.equal(app.$('mccDescription').disabled, true);
  assert.equal(app.$('mccForm').getAttribute('aria-busy'), 'true');
  await app.submit();
  assert.equal(app.requests.length, 1);
  resolveResponse({ ok: true, json: async () => ({ ok: true, data: recommendation }) });
  await pending;
  assert.equal(app.$('mccDescription').disabled, false);
  assert.equal(app.$('mccForm').getAttribute('aria-busy'), 'false');
});

test('Пустой ввод и превышение лимита не отправляются на сервер', async t => {
  const app = page();
  t.after(() => app.dom.window.close());
  for (const text of [' \n ', 'я'.repeat(3001)]) {
    app.input(text);
    await app.submit();
  }
  assert.equal(app.requests.length, 0);
  app.input('Продуктовый магазин');
  assert.equal(app.$('mccDescription').validationMessage, '');
  await app.submit();
  assert.equal(app.requests.length, 1);
});

test('При неоднозначности показывается уточнение, изменение текста скрывает старый ответ', async t => {
  const clarification = 'Какие товары продаёт магазин и что даёт основную выручку?';
  const app = page(async () => ({ ok: true, json: async () => ({ ok: true, data: {
    mcc: '', description: '', reason: '', clarification
  } }) }));
  t.after(() => app.dom.window.close());
  app.input('Магазин');
  await app.submit();
  assert.equal(app.$('mccResultTitle').textContent, 'Нужно уточнить описание');
  assert.equal(app.$('mccSuggestion').hidden, true);
  assert.equal(app.$('mccClarification').textContent, clarification);
  assert.equal(app.$('mccClarification').hidden, false);
  app.input('Магазин продуктов');
  assert.equal(app.$('mccResult').hidden, true);
});

test('Ошибка API, сеть, таймаут, старый сервер и некорректный результат допускают повтор', async t => {
  const failures = [
    async () => ({ ok: false, status: 503 }),
    async () => { throw new Error('network offline'); },
    async () => { const error = new Error('aborted'); error.name = 'AbortError'; throw error; },
    async () => ({ ok: true, json: async () => { throw new Error('not json'); } }),
    async () => ({ ok: true, json: async () => ({ ok: false, error: 'Лимит запросов' }) }),
    async () => ({ ok: true, json: async () => ({ ok: true, data: { ...recommendation, mcc: '541' } }) })
  ];
  for (const failure of failures) {
    const app = page(failure);
    t.after(() => app.dom.window.close());
    app.input('Продуктовый магазин');
    await app.submit();
    assert.equal(app.$('mccResult').hidden, true);
    assert.match(app.$('mccStatus').className, /err/);
    assert.equal(app.$('mccSubmitBtn').disabled, false);
    assert.equal(app.$('mccDescription').disabled, false);
  }
});

test('Ответ нейросети выводится текстом, HTML из ответа не выполняется', async t => {
  const description = '<img src=x onerror="alert(1)">';
  const app = page(async () => ({ ok: true, json: async () => ({ ok: true, data: { ...recommendation, description } }) }));
  t.after(() => app.dom.window.close());
  app.input('Продуктовый магазин');
  await app.submit();
  assert.equal(app.$('mccCategory').textContent, description);
  assert.equal(app.$('mccCategory').querySelector('img'), null);
});

test('Форма и Apps Script обмениваются запросом и результатом без изменения данных чека', async t => {
  const server = harness();
  const app = page(async (url, options) => ({ ok: true, json: async () => server.post(JSON.parse(options.body)).json() }));
  t.after(() => app.dom.window.close());
  app.dom.window.renderFields({ inn: '1234567890', store_name: 'Мой магазин' });
  app.input('Продуктовый супермаркет');
  await app.submit();
  assert.equal(app.$('mccCode').textContent, '5411');
  assert.equal(app.$('fld_inn').value, '1234567890');
  assert.equal(app.$('fld_store_name').value, 'Мой магазин');
  assert.equal(server.savedRows.length, 0);
});
