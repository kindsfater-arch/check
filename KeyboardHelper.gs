// KeyboardHelper.gs — формирование клавиатур и текста сообщений

var KeyboardHelper = (function () {

  // Формирует inline-клавиатуру для редактирования полей
  // Каждое поле — отдельная кнопка, внизу — «Сохранить» и «Отменить»
  function getEditKeyboard(data) {
    var fieldButtons = FIELD_KEYS.map(function (key) {
      var label = FIELD_LABELS[key];
      var value = data[key];
      var display = value ? value : '—';
      // Обрезаем длинные значения чтобы кнопка не переполнялась
      if (display.length > 20) display = display.substring(0, 18) + '…';
      return [{ text: label + ': ' + display, callback_data: 'edit:' + key }];
    });

    var actionButtons = [
      [
        { text: '✅ Сохранить', callback_data: 'action:save' },
        { text: '❌ Отменить', callback_data: 'action:cancel' }
      ]
    ];

    return {
      inline_keyboard: fieldButtons.concat(actionButtons)
    };
  }

  // Форматирует данные чека в читаемый текст HTML
  function formatReceiptText(data) {
    var lines = ['<b>📋 Данные чека:</b>'];
    FIELD_KEYS.forEach(function (key) {
      var label = FIELD_LABELS[key];
      var value = data[key] || '<i>не заполнено</i>';
      lines.push('<b>' + label + ':</b> ' + value);
    });
    lines.push('');
    lines.push('Нажмите на поле чтобы изменить его, затем нажмите <b>Сохранить</b>.');
    return lines.join('\n');
  }

  return { getEditKeyboard: getEditKeyboard, formatReceiptText: formatReceiptText };
})();
