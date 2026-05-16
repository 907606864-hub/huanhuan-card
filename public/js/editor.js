// editor.js - Card editor, agent chat, refine sidebar, and regex customization
import { editingCardId, editorLoading, editorSaving, editorData, editorEntries,
         editorCoverPreview, editorCoverBase64, editorDescPreview, editorGreetingPreview,
         currentView, counters, cardForm, results, previewTab, createStep,
         agentChat, prefillCOTSetting, stepLabels, worldbookEntries,
         refineOpen, refineMessages, refineInput, refineSending,
         regexCustomize, regexStylePresets, importedRegexScripts } from './state.js';
import { toast, stripCodeBlock, wrapCodeBlock, extractCSSVariables } from './utils.js';
import { loadCards } from './generate.js';
import { parseWorldbookFromMarkdown } from './worldbook.js';

const { reactive, nextTick } = Vue;

// ===== Card Editor Functions =====
export async function startEditCard(cardId) {
  editingCardId.value = cardId;
  editorLoading.value = true;
  editorData.name = undefined;
  editorEntries.value = [];
  editorCoverPreview.value = null;
  editorCoverBase64.value = null;
  editorDescPreview.value = false;
  editorGreetingPreview.value = false;
  currentView.value = 'card-editor';

  try {
    const res = await fetch(`/api/cards/${cardId}`);
    if (!res.ok) throw new Error('加载失败');
    const card = await res.json();

    let charData = {};
    try {
      charData = typeof card.character_data === 'string' ? JSON.parse(card.character_data) : (card.character_data || {});
    } catch (e) {
      charData = {};
    }

    editorData.name = card.name || '';
    editorData.description = card.description || '';
    editorData.version = card.version || 1;
    editorData.charDescription = charData.description || '';
    editorData.firstMes = charData.firstMes || charData.first_mes || '';

    editorData.regexScripts = (charData.regexScripts || []).map(rs => ({
      ...rs,
      _expanded: false,
    }));

    editorData.tavernHelperScripts = (charData.tavernHelperScripts || []).map(ts => ({
      ...ts,
      _expanded: false,
    }));

    const bookEntries = (charData.characterBook && charData.characterBook.entries) || [];
    editorEntries.value = bookEntries.map(e => ({
      _uid: counters.editorEntryNextUid++,
      _collapsed: true,
      comment: e.comment || '',
      keys: e.keys || [],
      secondary_keys: e.secondary_keys || [],
      content: e.content || '',
      enabled: e.enabled !== false,
      constant: !!e.constant,
      selective: e.selective !== undefined ? e.selective : true,
      position: e.position || 'before_char',
      depth: (e.extensions && e.extensions.depth !== undefined) ? e.extensions.depth : 4,
      extensions_position: (e.extensions && e.extensions.position !== undefined) ? e.extensions.position : 0,
      insertion_order: e.insertion_order !== undefined ? e.insertion_order : 0,
      role: (e.extensions && e.extensions.role !== undefined) ? e.extensions.role : 0,
    }));

    if (card.format === 'png' && card.card_file_path) {
      editorCoverPreview.value = `/api/cards/${cardId}/download`;
    }

    editorData._rawCharData = charData;

  } catch (e) {
    toast('加载卡片失败: ' + e.message, 'error');
    currentView.value = 'cards';
  } finally {
    editorLoading.value = false;
  }
}

export function addEditorEntry() {
  editorEntries.value.push({
    _uid: counters.editorEntryNextUid++,
    _collapsed: false,
    comment: '',
    keys: [],
    secondary_keys: [],
    content: '',
    enabled: true,
    constant: false,
    selective: true,
    position: 'before_char',
    depth: 4,
    extensions_position: 0,
    insertion_order: editorEntries.value.length,
    role: 0,
  });
}

export function removeEditorEntry(idx) {
  editorEntries.value.splice(idx, 1);
}

export function moveEditorEntry(idx, direction) {
  const newIdx = idx + direction;
  if (newIdx < 0 || newIdx >= editorEntries.value.length) return;
  const arr = editorEntries.value;
  const temp = arr[idx];
  arr[idx] = arr[newIdx];
  arr[newIdx] = temp;
  editorEntries.value = [...arr];
}

export function uploadEditorCover(event) {
  const file = event.target.files[0];
  if (!file) return;

  const img = new Image();
  img.onload = () => {
    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    canvas.getContext('2d').drawImage(img, 0, 0);
    const pngDataUrl = canvas.toDataURL('image/png');
    editorCoverPreview.value = pngDataUrl;
    editorCoverBase64.value = pngDataUrl.split(',')[1];
    URL.revokeObjectURL(img.src);
    toast('封面上传成功', 'success');
  };
  img.onerror = () => {
    URL.revokeObjectURL(img.src);
    toast('图片加载失败', 'error');
  };
  img.src = URL.createObjectURL(file);
  event.target.value = '';
}

export async function saveEditorCard() {
  if (!editingCardId.value) return;
  editorSaving.value = true;

  try {
    const rawChar = editorData._rawCharData || {};
    const updatedCharData = {
      ...rawChar,
      name: editorData.name,
      description: editorData.charDescription,
      firstMes: editorData.firstMes,
      first_mes: editorData.firstMes,
    };

    if (editorData.regexScripts && editorData.regexScripts.length) {
      updatedCharData.regexScripts = editorData.regexScripts.map(rs => {
        const { _expanded, ...rest } = rs;
        return rest;
      });
      if (!updatedCharData.extensions) updatedCharData.extensions = {};
      updatedCharData.extensions.regex_scripts = updatedCharData.regexScripts;
    }

    const entriesPayload = editorEntries.value.map((e, idx) => ({
      comment: e.comment,
      content: e.content,
      keys: e.keys,
      secondary_keys: e.secondary_keys,
      enabled: e.enabled,
      constant: e.constant,
      selective: e.selective,
      position: e.position,
      depth: e.depth,
      extensions_position: e.extensions_position,
      insertion_order: idx,
      role: e.role,
    }));

    const body = {
      name: editorData.name,
      description: editorData.description,
      character_data: JSON.stringify(updatedCharData),
      entries: entriesPayload,
    };

    if (editorCoverBase64.value) {
      body.cover_image_base64 = editorCoverBase64.value;
    }

    const res = await fetch(`/api/cards/${editingCardId.value}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || '保存失败');
    }

    const data = await res.json();
    editorData.version = data.version;
    toast(data.message || '保存成功', 'success');

    loadCards();

    editorCoverBase64.value = null;
    if (data.format === 'png') {
      editorCoverPreview.value = `/api/cards/${editingCardId.value}/download?v=${data.version}`;
    }

  } catch (e) {
    toast('保存失败: ' + e.message, 'error');
  } finally {
    editorSaving.value = false;
  }
}

// ===== Agent Chat Functions =====
export function parsePresetJSON(json) {
  var prompts = json.prompts || [];
  var validPrompts = prompts.filter(function (p) {
    return !p.marker && p.content && p.content.trim();
  });

  var enabledPrompts = validPrompts.filter(function (p) { return p.enabled; });
  var disabledPrompts = validPrompts.filter(function (p) { return !p.enabled; });

  var systemPrompt = enabledPrompts.map(function (p) { return p.content.trim(); }).join('\n\n');
  var pipelineSteps = disabledPrompts.map(function (p) {
    return {
      name: p.name || p.identifier,
      content: p.content.trim(),
      role: p.role || 'system',
    };
  });

  return { systemPrompt: systemPrompt, pipelineSteps: pipelineSteps, modelParams: {} };
}

export function handlePresetUpload(event) {
  var file = event.target.files[0];
  if (!file) return;

  var reader = new FileReader();
  reader.onload = function (e) {
    try {
      var json = JSON.parse(e.target.result);
      agentChat.presetConfig = parsePresetJSON(json);
      agentChat.presetName = file.name.replace(/\.json$/i, '');
      toast('预设解析成功: ' + agentChat.presetName, 'success');
    } catch (err) {
      toast('预设 JSON 解析失败: ' + err.message, 'error');
    }
  };
  reader.readAsText(file);
  event.target.value = '';
}

export function startAgentChat(mode) {
  agentChat.mode = mode;
  agentChat.showSetupModal = false;
  agentChat.messages = [];
  agentChat.cardReady = false;
  if (mode === 'default') {
    agentChat.presetConfig = null;
  }
}

function scrollAgentMessages() {
  nextTick(function () {
    var el = document.querySelector('.agent-messages');
    if (el) el.scrollTop = el.scrollHeight;
  });
}

export async function sendAgentMessage() {
  var text = agentChat.inputText.trim();
  if (!text || agentChat.sending) return;
  if (!cardForm.aiKeyId) {
    toast('请先选择 AI', 'error');
    return;
  }

  agentChat.messages.push({ role: 'user', content: text });
  agentChat.inputText = '';
  agentChat.sending = true;
  agentChat.streaming = true;
  scrollAgentMessages();

  var assistantContent = '';

  try {
    var res = await fetch('/api/agent/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: agentChat.messages,
        presetConfig: agentChat.presetConfig || null,
        aiKeyId: cardForm.aiKeyId,
        prefillSetting: prefillCOTSetting.value,
      }),
    });

    if (!res.ok) {
      var errData = await res.json();
      throw new Error(errData.error || '请求失败');
    }

    var bodyReader = res.body.getReader();
    var decoder = new TextDecoder();
    var buffer = '';

    while (true) {
      var result = await bodyReader.read();
      if (result.done) break;

      buffer += decoder.decode(result.value, { stream: true });
      var lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (var i = 0; i < lines.length; i++) {
        var line = lines[i].trim();
        if (!line || !line.startsWith('data: ')) continue;
        try {
          var data = JSON.parse(line.slice(6));
          if (data.error) {
            toast('AI 错误: ' + data.error, 'error');
          } else if (data.content && !data.done) {
            assistantContent += data.content;
            scrollAgentMessages();
          } else if (data.done && data.content) {
            assistantContent = data.content;
          }
        } catch (parseErr) { /* skip */ }
      }
    }

    if (assistantContent) {
      agentChat.messages.push({ role: 'assistant', content: assistantContent });

      if (assistantContent.indexOf('<CardReady>') !== -1) {
        agentChat.cardReady = true;
      }
    }
  } catch (err) {
    toast('发送失败: ' + err.message, 'error');
  } finally {
    agentChat.sending = false;
    agentChat.streaming = false;
    scrollAgentMessages();
  }
}

export async function extractAndFinalize() {
  if (!cardForm.aiKeyId) {
    toast('请先选择 AI', 'error');
    return;
  }
  agentChat.extracting = true;

  try {
    var res = await fetch('/api/agent/extract', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: agentChat.messages,
        aiKeyId: cardForm.aiKeyId,
      }),
    });

    if (!res.ok) {
      var errData = await res.json();
      throw new Error(errData.error || '提取失败');
    }

    var data = await res.json();

    if (data.name) cardForm.name = data.name;
    if (data.character) results.character = data.character;
    if (data.worldbook) results.worldbook = data.worldbook;
    if (data.greeting) results.greeting = data.greeting;

    if (results.worldbook) {
      parseWorldbookFromMarkdown();
    }

    currentView.value = 'create';
    createStep.value = 7;
    previewTab.value = 'character';

    toast('角色卡数据已提取，可在预览区编辑后导出', 'success');
  } catch (err) {
    toast('提取失败: ' + err.message, 'error');
  } finally {
    agentChat.extracting = false;
  }
}

export function resetAgentChat() {
  agentChat.mode = null;
  agentChat.presetConfig = null;
  agentChat.presetName = '';
  agentChat.messages = [];
  agentChat.inputText = '';
  agentChat.sending = false;
  agentChat.streaming = false;
  agentChat.cardReady = false;
  agentChat.extracting = false;
  agentChat.showSetupModal = true;
}

export function renderAgentMessage(content) {
  var cleaned = content.replace(/<CardReady>[\s\S]*?<\/CardReady>/gi, '');
  try {
    return marked.parse(cleaned);
  } catch (e) {
    return cleaned;
  }
}

// ===== Refine Sidebar =====
export function toggleRefine() {
  refineOpen.value = !refineOpen.value;
  if (refineOpen.value && refineMessages.value.length === 0) {
    refineMessages.value.push({
      role: 'assistant',
      content: '我是你的制卡助手，可以帮你细化角色设定的任何部分。比如告诉我「帮我把说话方式写得更有特色」，我会根据当前卡片内容给出建议。',
    });
  }
}

function scrollRefineMessages() {
  nextTick(function () {
    var el = document.querySelector('.refine-messages');
    if (el) el.scrollTop = el.scrollHeight;
  });
}

export async function sendRefineMessage() {
  var text = refineInput.value.trim();
  if (!text || refineSending.value) return;
  if (!cardForm.aiKeyId) {
    toast('请先在设置中选择 AI', 'error');
    return;
  }

  refineMessages.value.push({ role: 'user', content: text });
  refineInput.value = '';
  refineSending.value = true;
  scrollRefineMessages();

  var assistantContent = '';

  try {
    var apiMessages = refineMessages.value
      .filter(function (m, idx) { return !(idx === 0 && m.role === 'assistant'); })
      .map(function (m) { return { role: m.role, content: m.content }; });

    var res = await fetch('/api/agent/refine', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: apiMessages,
        cardContext: {
          ...results,
          _worldbookEntries: worldbookEntries.value.map(function (e) {
            return {
              name: e.name, keywords: e.keywords,
              type: e.type, position: e.position,
              enabled: e.enabled, constant: e.constant, selective: e.selective
            };
          })
        },
        field: '',
        aiKeyId: cardForm.aiKeyId,
        prefillSetting: prefillCOTSetting.value,
      }),
    });

    if (!res.ok) {
      var errData = await res.json();
      throw new Error(errData.error || '请求失败');
    }

    var bodyReader = res.body.getReader();
    var decoder = new TextDecoder();
    var buffer = '';

    refineMessages.value.push({ role: 'assistant', content: '', _streaming: true });
    var lastIdx = refineMessages.value.length - 1;

    while (true) {
      var chunk = await bodyReader.read();
      if (chunk.done) break;

      buffer += decoder.decode(chunk.value, { stream: true });
      var lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (var i = 0; i < lines.length; i++) {
        var line = lines[i].trim();
        if (!line || !line.startsWith('data: ')) continue;
        try {
          var data = JSON.parse(line.slice(6));
          if (data.error) {
            toast('AI 错误: ' + data.error, 'error');
          } else if (data.content && !data.done) {
            assistantContent += data.content;
            refineMessages.value[lastIdx].content = assistantContent;
            scrollRefineMessages();
          } else if (data.done && data.content) {
            assistantContent = data.content;
            refineMessages.value[lastIdx].content = assistantContent;
          }
        } catch (parseErr) { /* skip */ }
      }
    }

    refineMessages.value[lastIdx]._streaming = false;
  } catch (err) {
    toast('发送失败: ' + err.message, 'error');
  } finally {
    refineSending.value = false;
    scrollRefineMessages();
  }
}

export function applyChange(field, content) {
  if (results.hasOwnProperty(field)) {
    results[field] = content;
    toast('已应用修改到「' + (stepLabels[field] || field) + '」', 'success');
  } else {
    toast('未知字段: ' + field, 'error');
  }
}

export function renderRefineMessage(content) {
  var processed = content.replace(
    /<EditField\s+field="([^"]+)">([\s\S]*?)<\/EditField>/g,
    function (match, field, inner) {
      var changes = [];
      var srRegex = /<SearchReplace>\s*<Search>([\s\S]*?)<\/Search>\s*<Replace>([\s\S]*?)<\/Replace>\s*<\/SearchReplace>/g;
      var srMatch;
      while ((srMatch = srRegex.exec(inner)) !== null) {
        changes.push({ search: srMatch[1], replace: srMatch[2] });
      }

      if (changes.length === 0) return match;

      var diffHtml = '';
      for (var c = 0; c < changes.length; c++) {
        var searchEsc = changes[c].search.replace(/</g, '&lt;').replace(/>/g, '&gt;');
        var replaceEsc = changes[c].replace.replace(/</g, '&lt;').replace(/>/g, '&gt;');
        diffHtml += '<div class="refine-diff-hunk">' +
          '<div class="refine-diff-remove"><span class="refine-diff-prefix">−</span><span>' + searchEsc + '</span></div>' +
          '<div class="refine-diff-add"><span class="refine-diff-prefix">+</span><span>' + replaceEsc + '</span></div>' +
          '</div>';
        if (c < changes.length - 1) diffHtml += '<div class="refine-diff-separator"></div>';
      }

      return '<div class="refine-diff-block">' +
        '<div class="refine-diff-label"><svg class="lucide" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin-right:4px"><use href="#lucide-edit-3"/></svg> 精确编辑 — ' + (stepLabels[field] || field) + '（' + changes.length + ' 处修改）</div>' +
        '<div class="refine-diff-content">' + diffHtml + '</div>' +
        '<button class="btn btn-sm btn-primary refine-apply-btn" onclick="window.__applyRefineEdit(\'' + field + '\')"><svg class="lucide" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin-right:4px"><use href="#lucide-check-circle"/></svg> 应用修改</button>' +
        '</div>';
    }
  );

  processed = processed.replace(
    /<ApplyChange\s+field="([^"]+)">([\s\S]*?)<\/ApplyChange>/g,
    function (match, field, inner) {
      var escapedContent = inner.replace(/</g, '&lt;').replace(/>/g, '&gt;');
      return '<div class="refine-apply-block">' +
        '<div class="refine-apply-label"><svg class="lucide" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin-right:4px"><use href="#lucide-file-text"/></svg> 全量替换 — ' + (stepLabels[field] || field) + '</div>' +
        '<pre class="refine-apply-content">' + escapedContent + '</pre>' +
        '<button class="btn btn-sm btn-primary refine-apply-btn" onclick="window.__applyRefineChange(\'' + field + '\')"><svg class="lucide" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin-right:4px"><use href="#lucide-check-circle"/></svg> 应用修改</button>' +
        '</div>';
    }
  );

  // EditEntryMeta rendering
  processed = processed.replace(
    /<EditEntryMeta\s+entry="([^"]+)">([\s\S]*?)<\/EditEntryMeta>/g,
    function (match, entryName, inner) {
      var fields = ['keywords', 'name', 'type', 'position', 'constant', 'selective', 'enabled'];
      var fieldLabels = { keywords: '关键词', name: '条目名', type: '类型', position: '位置', constant: '常驻', selective: '选择性', enabled: '启用' };
      var newVals = {};
      for (var fi = 0; fi < fields.length; fi++) {
        var fld = fields[fi];
        var fldRegex = new RegExp('<' + fld + '>([\\s\\S]*?)</' + fld + '>');
        var fldMatch = inner.match(fldRegex);
        if (fldMatch) newVals[fld] = fldMatch[1].trim();
      }
      if (Object.keys(newVals).length === 0) return match;

      // Find old entry by name
      var oldEntry = null;
      for (var ei = 0; ei < worldbookEntries.value.length; ei++) {
        if (worldbookEntries.value[ei].name === entryName) {
          oldEntry = worldbookEntries.value[ei];
          break;
        }
      }
      var entryId = oldEntry ? oldEntry.id : -1;

      var diffHtml = '';
      var changedFields = Object.keys(newVals);
      for (var ci = 0; ci < changedFields.length; ci++) {
        var key = changedFields[ci];
        // P1#3 fix: arrays use .join(', ') instead of String()
        var rawOldVal = oldEntry ? (oldEntry[key] != null ? oldEntry[key] : '') : '?';
        var oldVal = Array.isArray(rawOldVal) ? rawOldVal.join(', ') : String(rawOldVal);
        var newVal = newVals[key];
        var oldEsc = oldVal.replace(/</g, '&lt;').replace(/>/g, '&gt;');
        var newEsc = newVal.replace(/</g, '&lt;').replace(/>/g, '&gt;');
        diffHtml += '<div class="refine-diff-hunk">' +
          '<div style="color:#888;font-size:12px;margin-bottom:2px">' + (fieldLabels[key] || key) + '</div>' +
          '<div class="refine-diff-remove"><span class="refine-diff-prefix">−</span><span>' + oldEsc + '</span></div>' +
          '<div class="refine-diff-add"><span class="refine-diff-prefix">+</span><span>' + newEsc + '</span></div>' +
          '</div>';
        if (ci < changedFields.length - 1) diffHtml += '<div class="refine-diff-separator"></div>';
      }

      // P1#5 fix: use data attributes instead of inline string concat to prevent XSS
      var entryNameAttr = entryName.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      return '<div class="refine-diff-block">' +
        '<div class="refine-diff-label"><svg class="lucide" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin-right:4px"><use href="#lucide-edit-3"/></svg> 📋 修改条目元数据 — "' + entryName.replace(/</g, '&lt;').replace(/>/g, '&gt;') + '"（' + changedFields.length + ' 个字段）</div>' +
        '<div class="refine-diff-content">' + diffHtml + '</div>' +
        '<button class="btn btn-sm btn-primary refine-apply-btn" data-entry-name="' + entryNameAttr + '" data-entry-id="' + entryId + '" onclick="window.__applyRefineEntryMeta(this.dataset.entryName, Number(this.dataset.entryId))"><svg class="lucide" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin-right:4px"><use href="#lucide-check-circle"/></svg> 应用修改</button>' +
        '</div>';
    }
  );

  try {
    return marked.parse(processed);
  } catch (e) {
    return processed;
  }
}

export function setupRefineGlobalHandlers() {
  window.__applyRefineChange = function (field) {
    for (var i = refineMessages.value.length - 1; i >= 0; i--) {
      var msg = refineMessages.value[i];
      if (msg.role !== 'assistant') continue;
      var regex = new RegExp('<ApplyChange\\s+field="' + field + '">([\\s\\S]*?)</ApplyChange>');
      var match = msg.content.match(regex);
      if (match) {
        applyChange(field, match[1].trim());
        return;
      }
    }
    toast('未找到可应用的修改', 'error');
  };

  window.__applyRefineEdit = function (field) {
    for (var i = refineMessages.value.length - 1; i >= 0; i--) {
      var msg = refineMessages.value[i];
      if (msg.role !== 'assistant') continue;

      var fieldRegex = new RegExp('<EditField\\s+field="' + field + '">([\\s\\S]*?)</EditField>');
      var fieldMatch = msg.content.match(fieldRegex);
      if (!fieldMatch) continue;

      var inner = fieldMatch[1];
      var srRegex = /<SearchReplace>\s*<Search>([\s\S]*?)<\/Search>\s*<Replace>([\s\S]*?)<\/Replace>\s*<\/SearchReplace>/g;
      var srMatch;
      var currentContent = results[field] || '';
      var applied = 0;
      var failed = 0;

      while ((srMatch = srRegex.exec(inner)) !== null) {
        var searchText = srMatch[1];
        var replaceText = srMatch[2];

        if (currentContent.indexOf(searchText) !== -1) {
          currentContent = currentContent.replace(searchText, replaceText);
          applied++;
        } else {
          failed++;
        }
      }

      if (applied > 0) {
        results[field] = currentContent;
        var msg2 = '已应用 ' + applied + ' 处修改到「' + (stepLabels[field] || field) + '」';
        if (failed > 0) msg2 += '（' + failed + ' 处未匹配，已跳过）';
        toast(msg2, failed > 0 ? 'warning' : 'success');
      } else {
        toast('所有修改均未匹配到原文，可能内容已被更改', 'error');
      }
      return;
    }
    toast('未找到可应用的编辑', 'error');
  };

  window.__applyRefineEntryMeta = function (entryName, entryId) {
    // Find the EditEntryMeta block from the latest assistant message
    var fields = ['keywords', 'name', 'type', 'position', 'constant', 'selective', 'enabled'];
    // P1#4: type/position enum normalization maps
    var typeMap = { '蓝色': 'blue', '绿色': 'green', '蓝': 'blue', '绿': 'green' };
    var positionMap = { '角色定义之前': 'before_char', '角色定义之后': 'after_char' };
    for (var i = refineMessages.value.length - 1; i >= 0; i--) {
      var msg = refineMessages.value[i];
      if (msg.role !== 'assistant') continue;

      var regex = new RegExp('<EditEntryMeta\\s+entry="' + entryName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '">([\\s\\S]*?)</EditEntryMeta>');
      var match = msg.content.match(regex);
      if (!match) continue;

      var inner = match[1];
      var newVals = {};
      for (var fi = 0; fi < fields.length; fi++) {
        var fld = fields[fi];
        var fldRegex = new RegExp('<' + fld + '>([\\s\\S]*?)</' + fld + '>');
        var fldMatch = inner.match(fldRegex);
        if (fldMatch) newVals[fld] = fldMatch[1].trim();
      }

      // P0#2 fix: Find entry by name first, then fallback to id
      var entry = null;
      for (var ei = 0; ei < worldbookEntries.value.length; ei++) {
        if (worldbookEntries.value[ei].name === entryName) {
          entry = worldbookEntries.value[ei];
          break;
        }
      }
      if (!entry && typeof entryId === 'number' && entryId >= 0) {
        for (var ei2 = 0; ei2 < worldbookEntries.value.length; ei2++) {
          if (worldbookEntries.value[ei2].id === entryId) {
            entry = worldbookEntries.value[ei2];
            break;
          }
        }
      }
      if (!entry) {
        toast('未找到名为「' + entryName + '」的世界书条目', 'error');
        return;
      }

      // Apply changes field by field
      var boolFields = ['constant', 'selective', 'enabled'];
      var applied = [];
      var changedFields = Object.keys(newVals);
      for (var ci = 0; ci < changedFields.length; ci++) {
        var key = changedFields[ci];
        var val = newVals[key];
        // P1#4 fix: normalize Chinese type/position values
        if (key === 'type' && typeMap[val]) val = typeMap[val];
        if (key === 'position' && positionMap[val]) val = positionMap[val];
        if (boolFields.indexOf(key) !== -1) {
          entry[key] = val === 'true';
        } else if (key === 'keywords') {
          // P0#1 fix: convert comma-separated string to array
          entry[key] = val.split(',').map(function (k) { return k.trim(); }).filter(Boolean);
        } else {
          entry[key] = val;
        }
        applied.push(key);
      }

      toast('已修改「' + (entry.name || entryName) + '」的 ' + applied.length + ' 个字段', 'success');
      return;
    }
    toast('未找到可应用的条目元数据修改', 'error');
  };
}

export function clearRefineChat() {
  refineMessages.value = [];
  refineMessages.value.push({
    role: 'assistant',
    content: '我是你的制卡助手，可以帮你细化角色设定的任何部分。比如告诉我「帮我把说话方式写得更有特色」，我会根据当前卡片内容给出建议。',
  });
}

// ===== Regex Style Customization =====
export function getRegexPanel(source, index) {
  const panels = source === 'editor' ? regexCustomize.editorPanels : regexCustomize.importPanels;
  if (!panels[index]) {
    const scripts = source === 'editor' ? editorData.regexScripts : importedRegexScripts.value;
    const rs = scripts[index];
    const html = stripCodeBlock(rs?.replaceString || '');
    const cssVars = extractCSSVariables(html);
    panels[index] = reactive({
      showStyle: false,
      showAI: false,
      showSource: false,
      cssVars: cssVars,
      originalVars: cssVars.map(v => ({ ...v })),
      presetName: '默认',
      _originalHtml: html,
    });
  }
  return panels[index];
}

export function toggleRegexStylePanel(source, index) {
  const panel = getRegexPanel(source, index);
  panel.showStyle = !panel.showStyle;
  if (panel.showStyle) {
    panel.showAI = false;
    const scripts = source === 'editor' ? editorData.regexScripts : importedRegexScripts.value;
    const html = stripCodeBlock(scripts[index]?.replaceString || '');
    panel.cssVars = extractCSSVariables(html);
    panel.originalVars = panel.cssVars.map(v => ({ ...v }));
    panel._originalHtml = html;
  }
}

export function toggleRegexAIPanel(source, index) {
  const panel = getRegexPanel(source, index);
  panel.showAI = !panel.showAI;
  if (panel.showAI) {
    panel.showStyle = false;
    regexCustomize.aiStyles = [];
    regexCustomize.aiColors = [];
    regexCustomize.aiElements = [];
    regexCustomize.aiCustomRequest = '';
  }
}

export function toggleRegexSource(source, index) {
  const panel = getRegexPanel(source, index);
  panel.showSource = !panel.showSource;
}

export function getRegexSrcdoc(source, index) {
  const scripts = source === 'editor' ? editorData.regexScripts : importedRegexScripts.value;
  const rs = scripts[index];
  if (!rs) return '';
  return stripCodeBlock(rs.replaceString || '');
}

export function updateRegexCSSVar(source, index, varIndex, newValue) {
  const panel = getRegexPanel(source, index);
  panel.cssVars[varIndex].value = newValue;
}

export function applyRegexCSSChanges(source, index) {
  const panel = getRegexPanel(source, index);
  const scripts = source === 'editor' ? editorData.regexScripts : importedRegexScripts.value;
  let html = stripCodeBlock(scripts[index].replaceString || '');

  for (const v of panel.cssVars) {
    if (v.value !== v.originalValue) {
      const escapedName = v.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp('(' + escapedName + '\\s*:\\s*)([^;]+)(;)', 'g');
      html = html.replace(re, '$1' + v.value + '$3');
    }
  }

  scripts[index].replaceString = wrapCodeBlock(html);
  panel.originalVars = panel.cssVars.map(v => ({ ...v, originalValue: v.value }));
  panel._originalHtml = html;
  toast('样式已应用', 'success');
}

export function resetRegexCSSChanges(source, index) {
  const panel = getRegexPanel(source, index);
  panel.cssVars = panel.originalVars.map(v => ({ ...v }));
}

export function applyRegexPreset(source, index, presetName) {
  const panel = getRegexPanel(source, index);
  panel.presetName = presetName;

  if (presetName === '默认') {
    const scripts = source === 'editor' ? editorData.regexScripts : importedRegexScripts.value;
    const html = panel._originalHtml;
    const vars = extractCSSVariables(html);
    panel.cssVars = vars;
    return;
  }

  const preset = regexStylePresets[presetName];
  if (!preset) return;

  for (const v of panel.cssVars) {
    if (preset[v.name] !== undefined) {
      v.value = preset[v.name];
    }
  }
}

export function getRegexLiveSrcdoc(source, index) {
  const panel = getRegexPanel(source, index);
  const scripts = source === 'editor' ? editorData.regexScripts : importedRegexScripts.value;
  let html = stripCodeBlock(scripts[index]?.replaceString || '');

  if (panel && panel.showStyle && panel.cssVars.length) {
    for (const v of panel.cssVars) {
      const escapedName = v.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp('(' + escapedName + '\\s*:\\s*)([^;]+)(;)', 'g');
      html = html.replace(re, '$1' + v.value + '$3');
    }
  }

  return html;
}

export function toggleRegexAIOption(list, value) {
  const idx = list.indexOf(value);
  if (idx >= 0) list.splice(idx, 1);
  else list.push(value);
}

export async function startRegexAIRewrite(source, index) {
  const scripts = source === 'editor' ? editorData.regexScripts : importedRegexScripts.value;
  const rs = scripts[index];
  if (!rs) return;

  const html = stripCodeBlock(rs.replaceString || '');
  regexCustomize.aiGenerating = true;
  regexCustomize.aiStreamOutput = '';
  regexCustomize.aiTargetContext = { source, index };

  try {
    const res = await fetch('/api/generate/regex-customize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        currentHtml: html,
        scriptName: rs.scriptName || '正则脚本',
        stylePreferences: {
          styles: [...regexCustomize.aiStyles],
          colors: [...regexCustomize.aiColors],
          elements: [...regexCustomize.aiElements],
          customRequest: regexCustomize.aiCustomRequest,
        },
      }),
    });

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      let sseError = null;
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const data = JSON.parse(line.substring(6));
            if (data.error) {
              sseError = data.message || 'AI 生成失败';
            } else if (data.text !== undefined && !data.text.startsWith('{')) {
              regexCustomize.aiStreamOutput += data.text;
            }
          } catch { /* skip parse errors */ }
        }
      }
      if (sseError) throw new Error(sseError);
    }

    let result = regexCustomize.aiStreamOutput.trim();
    result = result.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
    result = stripCodeBlock(result);

    if (result) {
      scripts[index].replaceString = wrapCodeBlock(result);
      const panel = getRegexPanel(source, index);
      panel.cssVars = extractCSSVariables(result);
      panel.originalVars = panel.cssVars.map(v => ({ ...v }));
      panel._originalHtml = result;
      panel.showAI = false;
      toast('AI 样式重写完成！', 'success');
    } else {
      toast('AI 返回结果为空', 'error');
    }

  } catch (e) {
    toast('AI 生成失败: ' + e.message, 'error');
  } finally {
    regexCustomize.aiGenerating = false;
    regexCustomize.aiStreamOutput = '';
    regexCustomize.aiTargetContext = null;
  }
}

export function setupRegexIframeResize(iframe) {
  if (!iframe) return;
  const resize = () => {
    try {
      const body = iframe.contentDocument?.body;
      if (body) {
        const h = body.scrollHeight;
        iframe.style.height = Math.max(200, Math.min(h + 20, 800)) + 'px';
      }
    } catch { /* cross-origin, ignore */ }
  };
  iframe.addEventListener('load', resize);
  setTimeout(resize, 500);
  setTimeout(resize, 1500);
}
