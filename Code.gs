// Code.gs — главный файл: webhook, роутинг обновлений

// ─── Проверка деплоя через браузер ──────────────────────────────────────────
// Откройте WEBAPP_URL в браузере. Если видите "Bot is alive" — деплой работает,
// если редирект на Google login — настройки доступа неверные.
function doGet(e) {
  return ContentService.createTextOutput('Bot is alive ✓ ' + new Date().toISOString())
    .setMimeType(ContentService.MimeType.TEXT);
}

// ─── Точка входа webhook ─────────────────────────────────────────────────────

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return ContentService.createTextOutput('no data');
    }
    var body = JSON.parse(e.postData.contents);

    // Подбор MCC по тексту через тот же серверный доступ к Gemini.
    if (body && body.action === 'suggest_mcc') {
      try {
        var recommendation = GeminiService.suggestMcc(body.description);
        return ContentService.createTextOutput(JSON.stringify({ ok: true, data: recommendation }))
          .setMimeType(ContentService.MimeType.JSON);
      } catch (err) {
        Logger.log('suggest_mcc error: ' + err.message);
        return ContentService.createTextOutput(JSON.stringify({ ok: false, error: err.message }))
          .setMimeType(ContentService.MimeType.JSON);
      }
    }

    // ─── Запрос распознавания чека с веб-страницы index.html ───────────────
    // Веб-страница шлёт { action: 'recognize_receipt', imageBase64 }.
    // Gemini вызывается ОТСЮДА, с серверов Google — VPN у клиента не нужен.
    if (body && body.action === 'recognize_receipt') {
      try {
        var bytes = Utilities.base64Decode(body.imageBase64);
        var data = GeminiService.analyzeReceiptWithGemini(bytes);
        return ContentService.createTextOutput(JSON.stringify({ ok: true, data: data }))
          .setMimeType(ContentService.MimeType.JSON);
      } catch (err) {
        Logger.log('recognize_receipt error: ' + err.message);
        return ContentService.createTextOutput(JSON.stringify({ ok: false, error: err.message }))
          .setMimeType(ContentService.MimeType.JSON);
      }
    }

    // ─── Запрос сохранения чека с веб-страницы index.html ──────────────────
    // Веб-страница шлёт { action: 'save_receipt', userId, userName, data }.
    // Пишем в ту же таблицу тем же способом, что и бот (SheetsService).
    if (body && body.action === 'save_receipt') {
      try {
        SheetsService.saveToSheets(
          body.userId || 'web',
          body.userName || 'web',
          body.data || {}
        );
        return ContentService.createTextOutput(JSON.stringify({ ok: true }))
          .setMimeType(ContentService.MimeType.JSON);
      } catch (err) {
        Logger.log('save_receipt error: ' + err.message);
        return ContentService.createTextOutput(JSON.stringify({ ok: false, error: err.message }))
          .setMimeType(ContentService.MimeType.JSON);
      }
    }

    // ─── Иначе — обычный Telegram-апдейт (webhook), как раньше ──────────────
    handleUpdate(body);
  } catch (err) {
    Logger.log('doPost error: ' + err.message + '\n' + err.stack);
  }
  // Telegram требует ровно 200 OK — возвращаем его при любом исходе
  return ContentService.createTextOutput('OK')
    .setMimeType(ContentService.MimeType.TEXT);
}

// ─── Роутер обновлений ───────────────────────────────────────────────────────

function handleUpdate(update) {
  if (update.message) {
    var msg = update.message;
    var chatId = msg.chat.id;
    var userId = String(msg.from.id);
    var userName = msg.from.username
      ? '@' + msg.from.username
      : (msg.from.first_name || userId);

    if (msg.photo) {
      handlePhoto(chatId, userId, userName, msg);
      return;
    }

    // Поддержка отправки фото как файла (без сжатия Telegram)
    if (msg.document && msg.document.mime_type && msg.document.mime_type.indexOf('image/') === 0) {
      handlePhotoDocument(chatId, userId, userName, msg);
      return;
    }

    if (msg.text) {
      // Команды
      if (msg.text === '/start') {
        StateService.clearState(userId);
        TelegramService.sendMessage(chatId,
          '👋 Привет! Отправь фото кассового чека, и я распознаю его данные.\n\n💡 Для лучшего качества распознавания — отправляй как <b>файл</b> (скрепка → Файл), а не как обычное фото.');
        return;
      }
      if (msg.text === '/cancel') {
        StateService.clearState(userId);
        TelegramService.sendMessage(chatId, '🚫 Сессия отменена.');
        return;
      }

      // Возможно пользователь вводит значение поля
      handleFieldInput(chatId, userId, msg.text);
    }
    return;
  }

  if (update.callback_query) {
    handleCallbackQuery(update.callback_query);
  }
}

// ─── Обработка фото ──────────────────────────────────────────────────────────

function handlePhoto(chatId, userId, userName, msg) {
  // Берём фото с наибольшим разрешением
  var photos = msg.photo;
  var bestPhoto = photos[photos.length - 1];

  var processingMsg = TelegramService.sendMessage(chatId, '⏳ Распознаю чек, подождите…');

  try {
    var imageBytes = TelegramService.downloadPhotoBytes(bestPhoto.file_id);
    var data = GeminiService.analyzeReceiptWithGemini(imageBytes);

    // Сохраняем данные и статус в состояние
    StateService.saveState(userId, {
      data: data,
      status: 'review',
      userName: userName,
      messageId: processingMsg.result.message_id
    });

    var text = KeyboardHelper.formatReceiptText(data);
    var keyboard = KeyboardHelper.getEditKeyboard(data);

    TelegramService.editMessage(chatId, processingMsg.result.message_id, text, keyboard);

  } catch (err) {
    Logger.log('handlePhoto error: ' + err.message);
    TelegramService.editMessage(chatId, processingMsg.result.message_id,
      '❌ Ошибка при распознавании чека. Попробуйте ещё раз или отправьте другое фото.\n\nДетали: ' + err.message);
    StateService.clearState(userId);
  }
}

// ─── Обработка фото отправленного как файл (без сжатия) ─────────────────────

function handlePhotoDocument(chatId, userId, userName, msg) {
  var processingMsg = TelegramService.sendMessage(chatId, '⏳ Распознаю чек, подождите…');

  try {
    var imageBytes = TelegramService.downloadPhotoBytes(msg.document.file_id);
    var data = GeminiService.analyzeReceiptWithGemini(imageBytes);

    StateService.saveState(userId, {
      data: data,
      status: 'review',
      userName: userName,
      messageId: processingMsg.result.message_id
    });

    var text = KeyboardHelper.formatReceiptText(data);
    var keyboard = KeyboardHelper.getEditKeyboard(data);
    TelegramService.editMessage(chatId, processingMsg.result.message_id, text, keyboard);

  } catch (err) {
    Logger.log('handlePhotoDocument error: ' + err.message);
    TelegramService.editMessage(chatId, processingMsg.result.message_id,
      '❌ Ошибка при распознавании. Попробуйте ещё раз.\n\nДетали: ' + err.message);
    StateService.clearState(userId);
  }
}

// ─── Обработка inline-кнопок ─────────────────────────────────────────────────

function handleCallbackQuery(cbq) {
  var chatId = cbq.message.chat.id;
  var userId = String(cbq.from.id);
  var messageId = cbq.message.message_id;
  var callbackData = cbq.data;

  TelegramService.answerCallbackQuery(cbq.id);

  var state = StateService.loadState(userId);
  if (!state || state.status !== 'review') {
    TelegramService.sendMessage(chatId, '⚠️ Нет активной сессии. Отправьте фото чека.');
    return;
  }

  // Редактирование конкретного поля
  if (callbackData.indexOf('edit:') === 0) {
    var fieldKey = callbackData.replace('edit:', '');
    if (FIELD_KEYS.indexOf(fieldKey) === -1) return;

    StateService.saveState(userId, {
      status: 'awaiting_input',
      editingField: fieldKey,
      messageId: messageId
    });

    var label = FIELD_LABELS[fieldKey];
    var currentValue = state.data[fieldKey];
    var prompt = '✏️ Введите новое значение для поля <b>' + label + '</b>';
    if (currentValue) prompt += '\n\nТекущее: <i>' + currentValue + '</i>';
    prompt += '\n\nДля отмены нажмите /cancel';

    TelegramService.sendMessage(chatId, prompt);
    return;
  }

  // Действия: сохранить / отменить
  if (callbackData === 'action:save') {
    handleSave(chatId, userId, messageId, state);
    return;
  }

  if (callbackData === 'action:cancel') {
    StateService.clearState(userId);
    TelegramService.editMessage(chatId, messageId, '🚫 Сессия отменена. Отправьте новое фото чека.');
    return;
  }
}

// ─── Ввод значения поля ───────────────────────────────────────────────────────

function handleFieldInput(chatId, userId, text) {
  var state = StateService.loadState(userId);

  if (!state || state.status !== 'awaiting_input') {
    // Пользователь просто написал текст без активной сессии
    TelegramService.sendMessage(chatId, '📸 Отправьте фото кассового чека, чтобы начать.');
    return;
  }

  var fieldKey = state.editingField;
  var messageId = state.messageId;

  // Обновляем значение поля в данных
  var updatedData = state.data;
  updatedData[fieldKey] = text.trim();

  StateService.saveState(userId, {
    data: updatedData,
    status: 'review',
    editingField: null,
    messageId: messageId
  });

  // Обновляем сообщение с чеком
  var updatedText = KeyboardHelper.formatReceiptText(updatedData);
  var keyboard = KeyboardHelper.getEditKeyboard(updatedData);

  try {
    TelegramService.editMessage(chatId, messageId, updatedText, keyboard);
    TelegramService.sendMessage(chatId,
      '✅ Поле <b>' + FIELD_LABELS[fieldKey] + '</b> обновлено. Для сохранения информации нажмите сохранить.');
  } catch (err) {
    Logger.log('handleFieldInput editMessage error: ' + err.message);
    // Если сообщение не нашлось — шлём новое
    var newMsg = TelegramService.sendMessage(chatId, updatedText, keyboard);
    StateService.saveState(userId, { messageId: newMsg.result.message_id });
  }
}

// ─── Сохранение в Sheets ─────────────────────────────────────────────────────

function handleSave(chatId, userId, messageId, state) {
  try {
    SheetsService.saveToSheets(userId, state.userName || userId, state.data);
    StateService.clearState(userId);

    TelegramService.editMessage(chatId, messageId,
      '✅ <b>Чек сохранён!</b>\n\n' + KeyboardHelper.formatReceiptText(state.data).replace(
        '\n\nНажмите на поле чтобы изменить его, затем нажмите <b>Сохранить</b>.', ''));

    TelegramService.sendMessage(chatId,
      '📊 Данные записаны в таблицу. Можете отправить следующий чек.');

  } catch (err) {
    Logger.log('handleSave error: ' + err.message);
    TelegramService.sendMessage(chatId,
      '❌ Ошибка при сохранении в таблицу:\n' + err.message);
  }
}

// ─── Ежедневная рассылка таблицы по email ────────────────────────────────────

// Вызывается триггером каждый день. Экспортирует таблицу в XLSX и отправляет на REPORT_EMAIL.
function sendDailyReport() {
  var exportUrl = 'https://docs.google.com/spreadsheets/d/' + SHEET_ID + '/export?format=xlsx';
  var token = ScriptApp.getOAuthToken();
  var response = UrlFetchApp.fetch(exportUrl, {
    headers: { Authorization: 'Bearer ' + token },
    muteHttpExceptions: true
  });

  if (response.getResponseCode() !== 200) {
    Logger.log('sendDailyReport: ошибка экспорта ' + response.getResponseCode());
    return;
  }

  var dateStr = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd.MM.yyyy');
  var fileName = 'receipts_' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd') + '.xlsx';
  var blob = response.getBlob().setName(fileName);

  MailApp.sendEmail({
    to: REPORT_EMAIL,
    subject: 'Таблица чеков за ' + dateStr,
    body: 'Добрый день!\n\nВо вложении — актуальная таблица чеков на ' + dateStr + '.\n\nПисьмо отправлено автоматически.',
    attachments: [blob]
  });

  Logger.log('sendDailyReport: отправлено на ' + REPORT_EMAIL);
}

// Запустить один раз: создаёт ежедневный триггер отправки отчёта в 8:00.
function setupDailyEmail() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'sendDailyReport') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('sendDailyReport').timeBased().everyDays(1).atHour(8).create();
  Logger.log('setupDailyEmail: триггер создан, рассылка каждый день в 08:00.');
}

// Остановить рассылку — удаляет триггер.
function stopDailyEmail() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'sendDailyReport') ScriptApp.deleteTrigger(t);
  });
  Logger.log('stopDailyEmail: триггер удалён.');
}

// ─── Long polling вместо webhook ────────────────────────────────────────────
// Google Apps Script делает 302-редирект на POST-запросах от Telegram, который
// Telegram не следует. Поэтому используем getUpdates по time-триггеру.

// Вызывается триггером каждую минуту. Запрашивает новые апдейты у Telegram.
function pollUpdates() {
  var props = PropertiesService.getScriptProperties();
  var lastUpdateId = parseInt(props.getProperty('last_update_id') || '0', 10);

  var result;
  try {
    result = TelegramService.callTelegram('getUpdates', {
      offset: lastUpdateId + 1,
      timeout: 0,
      allowed_updates: ['message', 'callback_query']
    });
  } catch (err) {
    Logger.log('pollUpdates getUpdates error: ' + err.message);
    return;
  }

  if (!result.ok || !result.result || !result.result.length) return;

  var updates = result.result;
  Logger.log('pollUpdates: получено ' + updates.length + ' апдейтов');

  for (var i = 0; i < updates.length; i++) {
    var update = updates[i];
    try {
      handleUpdate(update);
    } catch (err) {
      Logger.log('handleUpdate failed for update ' + update.update_id + ': ' + err.message);
    }
    // Двигаем offset даже при ошибке — иначе зациклимся на «плохом» апдейте
    props.setProperty('last_update_id', String(update.update_id));
  }
}

// Запустить один раз: удаляет webhook (если был) и создаёт триггер опроса.
function setupPolling() {
  // Сбрасываем webhook и очередь
  var del = TelegramService.callTelegram('deleteWebhook', { drop_pending_updates: true });
  Logger.log('deleteWebhook: ' + JSON.stringify(del));

  // Удаляем существующие триггеры pollUpdates
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'pollUpdates') ScriptApp.deleteTrigger(t);
  });

  // Создаём новый триггер каждую минуту
  ScriptApp.newTrigger('pollUpdates').timeBased().everyMinutes(1).create();

  // Сбрасываем сохранённый offset
  PropertiesService.getScriptProperties().deleteProperty('last_update_id');

  Logger.log('Polling настроен: pollUpdates() будет вызываться каждую минуту.');
}

// Остановить polling — удаляет все триггеры pollUpdates.
function stopPolling() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'pollUpdates') ScriptApp.deleteTrigger(t);
  });
  Logger.log('Polling остановлен.');
}

// Установить webhook на WEBAPP_URL из Config.gs (запустить после деплоя CF Worker)
function setWebhook() {
  var result = TelegramService.callTelegram('setWebhook', {
    url: WEBAPP_URL,
    drop_pending_updates: true,
    allowed_updates: ['message', 'callback_query']
  });
  Logger.log('setWebhook result: ' + JSON.stringify(result));
}

// Проверить текущий статус webhook (должен быть пустым после setupPolling)
function getWebhookInfo() {
  var result = TelegramService.callTelegram('getWebhookInfo', {});
  Logger.log('webhookInfo: ' + JSON.stringify(result));
}
