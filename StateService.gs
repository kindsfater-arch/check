// StateService.gs — управление состоянием пользователей через PropertiesService

var StateService = (function () {
  var props = PropertiesService.getScriptProperties();

  function _key(userId) {
    return 'state_' + userId;
  }

  // Сохранить или обновить состояние пользователя (объект мёржится с текущим)
  function saveState(userId, update) {
    var current = loadState(userId) || {};
    var merged = Object.assign(current, update);
    props.setProperty(_key(userId), JSON.stringify(merged));
  }

  // Загрузить состояние; возвращает null если нет
  function loadState(userId) {
    var raw = props.getProperty(_key(userId));
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch (e) {
      return null;
    }
  }

  // Полностью удалить состояние пользователя
  function clearState(userId) {
    props.deleteProperty(_key(userId));
  }

  return { saveState: saveState, loadState: loadState, clearState: clearState };
})();
