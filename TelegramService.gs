// TelegramService.gs — взаимодействие с Telegram Bot API

var TelegramService = (function () {

  // Базовый вызов Telegram API
  function callTelegram(method, params) {
    var url = TELEGRAM_API_URL + '/' + method;
    var options = {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(params),
      muteHttpExceptions: true
    };
    var response = UrlFetchApp.fetch(url, options);
    var code = response.getResponseCode();
    var body = response.getContentText();
    if (code !== 200) {
      throw new Error('Telegram API error ' + code + ' on ' + method + ': ' + body);
    }
    return JSON.parse(body);
  }

  // Отправить новое сообщение
  function sendMessage(chatId, text, replyMarkup) {
    var params = {
      chat_id: chatId,
      text: text,
      parse_mode: 'HTML'
    };
    if (replyMarkup) params.reply_markup = replyMarkup;
    return callTelegram('sendMessage', params);
  }

  // Редактировать существующее сообщение
  function editMessage(chatId, messageId, text, replyMarkup) {
    var params = {
      chat_id: chatId,
      message_id: messageId,
      text: text,
      parse_mode: 'HTML'
    };
    if (replyMarkup) params.reply_markup = replyMarkup;
    return callTelegram('editMessageText', params);
  }

  // Ответить на callback_query (убрать «часики» у кнопки)
  function answerCallbackQuery(callbackQueryId, text) {
    var params = { callback_query_id: callbackQueryId };
    if (text) params.text = text;
    return callTelegram('answerCallbackQuery', params);
  }

  // Скачать байты файла по file_id
  function downloadPhotoBytes(fileId) {
    var fileInfo = callTelegram('getFile', { file_id: fileId });
    if (!fileInfo.ok) throw new Error('getFile failed: ' + JSON.stringify(fileInfo));

    var filePath = fileInfo.result.file_path;
    var fileUrl = TELEGRAM_FILE_URL + '/' + filePath;
    var response = UrlFetchApp.fetch(fileUrl, { muteHttpExceptions: true });

    if (response.getResponseCode() !== 200) {
      throw new Error('Failed to download file: ' + response.getResponseCode());
    }

    return response.getContent(); // массив байтов
  }

  return {
    callTelegram: callTelegram,
    sendMessage: sendMessage,
    editMessage: editMessage,
    answerCallbackQuery: answerCallbackQuery,
    downloadPhotoBytes: downloadPhotoBytes
  };
})();
