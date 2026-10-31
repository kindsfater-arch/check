const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { JSDOM } = require('jsdom');
const { root } = require('./helpers.cjs');
const catalog = require('../data/mcc-catalog.json');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

function page(t, source = html) {
  let requests = 0;
  const dom = new JSDOM(source, {
    runScripts: 'dangerously',
    beforeParse(window) {
      window.fetch = () => { requests++; throw new Error('Network unavailable'); };
      window.HTMLElement.prototype.scrollIntoView = function () {};
    }
  });
  t.after(() => dom.window.close());
  const $ = id => dom.window.document.getElementById(id);
  return {
    dom, $, get requests() { return requests; },
    input(code) {
      $('mccLookupInput').value = code;
      $('mccLookupInput').dispatchEvent(new dom.window.Event('input'));
    },
    submit() { $('mccLookupForm').dispatchEvent(new dom.window.Event('submit', { cancelable: true })); }
  };
}

test('Поиск открывается без фото; известный MCC и ведущий ноль работают без сети', t => {
  const app = page(t);
  assert.equal(app.$('mccLookupPanel').hidden, true);
  app.$('mccLookupToggleBtn').click();
  assert.equal(app.$('mccLookupPanel').hidden, false);
  assert.equal(app.$('mccLookupToggleBtn').getAttribute('aria-expanded'), 'true');
  assert.equal(app.dom.window.document.activeElement, app.$('mccLookupInput'));
  app.dom.window.renderFields({ inn: '1234567890', store_name: 'Магазин' });
  for (const code of ['5411', '0742', '5812']) {
    app.input(code);
    app.submit();
    assert.equal(app.$('mccLookupResult').hidden, false);
    assert.equal(app.$('mccLookupCode').textContent, code);
    assert.equal(app.$('mccLookupDescription').textContent, catalog.entries[code]);
    assert.equal(app.dom.window.document.activeElement, app.$('mccLookupResult'));
  }
  assert.equal(app.requests, 0);
  assert.equal(app.$('fld_inn').value, '1234567890');
  assert.equal(app.$('mccResult').hidden, true);
  assert.match(app.$('mccLookupDate').textContent, /^\d{2}\.\d{2}\.\d{4}$/);
  app.$('mccLookupToggleBtn').click();
  assert.equal(app.$('mccLookupPanel').hidden, true);
});

test('Проверка четырёх цифр и неизвестного кода; исправление убирает старый результат', t => {
  const app = page(t);
  app.input('5411'); app.submit();
  for (const code of ['', ' ', '742', '54111', '54ab', '-742', '5e11', '５４１１']) {
    app.input(code);
    assert.equal(app.$('mccLookupResult').hidden, true);
    app.submit();
    assert.equal(app.$('mccLookupInput').checkValidity(), false);
    assert.equal(app.$('mccLookupResult').hidden, true);
  }
  app.input('0000'); app.submit();
  assert.match(app.$('mccLookupStatusText').textContent, /не найден/);
  assert.equal(app.$('mccLookupResult').hidden, true);
  app.input('0742');
  assert.equal(app.$('mccLookupStatus').className, 'status');
  app.submit();
  assert.equal(app.$('mccLookupDescription').textContent, 'Ветеринарные услуги');
  assert.equal(app.requests, 0);
});

test('Встроенный справочник соответствует данным, все коды имеют описание', t => {
  const app = page(t);
  const embedded = JSON.parse(app.$('mccCatalog').textContent);
  assert.deepEqual(embedded, catalog);
  assert.equal(Object.keys(catalog.entries).length, 923);
  for (const [code, description] of Object.entries(catalog.entries)) {
    assert.match(code, /^\d{4}$/);
    assert.equal(typeof description, 'string');
    assert.ok(description.trim());
  }
});

test('Повреждённый справочник показывает ошибку и не ломает существующую форму', t => {
  const app = page(t, html.replace(/(<script type="application\/json" id="mccCatalog">)[\s\S]*?(<\/script>)/, '$1broken$2'));
  app.input('5411'); app.submit();
  assert.match(app.$('mccLookupStatusText').textContent, /Не удалось загрузить/);
  app.$('mccToggleBtn').click();
  assert.equal(app.$('mccPanel').hidden, false);
});
