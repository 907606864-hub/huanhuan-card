/**
 * Shared helpers for card routes (cards.js + generate.js)
 */
const crypto = require('crypto');

/**
 * Build the auto-update TavernHelper script for a given card ID
 */
function buildAutoUpdateScript(cardId) {
  const scriptContent = `(async () => {
  var CARD_ID = "${cardId}";
  var CHECK_URL = "https://huan.huan.baby/api/cards/public/" + CARD_ID + "/version";
  var DOWNLOAD_URL = "https://huan.huan.baby/api/cards/public/" + CARD_ID + "/download";

  try {
    var character = getCharacter();
    var localVersion = character && character.data && character.data.extensions && character.data.extensions.huanhuan_card_version || 0;

    var res = await fetch(CHECK_URL, { cache: "no-store" });
    if (!res.ok) return;
    var data = await res.json();
    var remoteVersion = data.version;
    var name = data.name;

    if (localVersion > 0 && remoteVersion > localVersion) {
      var confirmed = confirm(
        "\\u300c" + (name || character.name) + "\\u300d\\u6709\\u65b0\\u7248\\u672c\\uff08v" + remoteVersion + "\\uff09\\uff0c\\u662f\\u5426\\u66f4\\u65b0\\uff1f\\n" +
        "\\u5f53\\u524d\\u7248\\u672c\\uff1av" + localVersion
      );
      if (confirmed) {
        var cardRes = await fetch(DOWNLOAD_URL, { cache: "no-store" });
        var blob = await cardRes.blob();
        var file = new File([blob], (name || character.name) + ".png", { type: blob.type });
        await importRawCharacter(file);
      }
    }
  } catch (e) {
    console.warn("[\\u6b22\\u6b22\\u5236\\u5361\\u673a] \\u66f4\\u65b0\\u68c0\\u67e5\\u5931\\u8d25:", e.message);
  }
})();`;

  return {
    type: 'script',
    value: {
      id: crypto.randomUUID(),
      name: '欢欢制卡机自动更新',
      content: scriptContent,
      info: '自动检查并更新角色卡到最新版本',
      buttons: [],
      data: {},
      enabled: true,
    },
  };
}

/**
 * Inject huanhuan extensions and auto-update script into characterData
 */
function injectHuanhuanMeta(characterData, cardId, version) {
  /* Ensure extensions object exists */
  if (!characterData.extensions) {
    characterData.extensions = {};
  }
  characterData.extensions.huanhuan_card_id = cardId;
  characterData.extensions.huanhuan_card_version = version;

  /* Ensure tavernHelperScripts array exists */
  if (!Array.isArray(characterData.tavernHelperScripts)) {
    characterData.tavernHelperScripts = [];
  }

  /* Remove old auto-update script if present */
  characterData.tavernHelperScripts = characterData.tavernHelperScripts.filter(
    s => !(s && s.value && s.value.name === '欢欢制卡机自动更新')
  );

  /* Add fresh auto-update script */
  characterData.tavernHelperScripts.push(buildAutoUpdateScript(cardId));
}

module.exports = { buildAutoUpdateScript, injectHuanhuanMeta };
