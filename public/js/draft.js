// draft.js - Draft management and template editor
import { drafts, showDrafts, DRAFTS_KEY, AUTOSAVE_KEY, cardForm, results, worldbookEntries,
         TEMPLATES_KEY, templateEditor, templateNameMap, templateNames,
         counters, createStep, extraGenDone } from './state.js';
import { toast } from './utils.js';

// Forward declaration - charWBGenerated is imported from state
import { charWBGenerated } from './state.js';

export function loadDrafts() {
  try {
    const raw = localStorage.getItem(DRAFTS_KEY);
    drafts.value = raw ? JSON.parse(raw) : [];
  } catch { drafts.value = []; }
}

function buildSnapshot() {
  return {
    cardForm: JSON.parse(JSON.stringify(cardForm)),
    results: JSON.parse(JSON.stringify({ ...results })),
    worldbookEntries: worldbookEntries.value.map(e => {
      const clean = {};
      for (const [k, v] of Object.entries(e)) {
        if (!k.startsWith('_')) clean[k] = v;
      }
      return clean;
    }),
    charWBGenerated: JSON.parse(JSON.stringify(charWBGenerated)),
    createStep: createStep.value,
    extraGenDone: JSON.parse(JSON.stringify(extraGenDone)),
  };
}

export function saveAutoDraft() {
  try {
    const payload = {
      id: 'autosave',
      name: cardForm.name || '未命名草稿',
      timestamp: new Date().toISOString(),
      auto: true,
      ...buildSnapshot(),
    };
    localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(payload));
  } catch {}
}

export function loadAutoDraft() {
  try {
    const raw = localStorage.getItem(AUTOSAVE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function clearAutoDraft() {
  try { localStorage.removeItem(AUTOSAVE_KEY); } catch {}
}

function saveDrafts() {
  localStorage.setItem(DRAFTS_KEY, JSON.stringify(drafts.value));
}

export function hasCreateContent() {
  return cardForm.name || results.character || results.worldbook || results.greeting ||
    cardForm.characters.some(c => c.nameSimple || c.input || c.name || c.personality);
}

export function saveDraft(promptName) {
  const name = promptName || cardForm.name || '未命名草稿';
  const draft = {
    id: Date.now(),
    name,
    timestamp: new Date().toISOString(),
    auto: false,
    ...buildSnapshot(),
  };
  drafts.value.unshift(draft);
  if (drafts.value.length > 20) drafts.value.pop();
  saveDrafts();
}

export function restoreDraft(draft) {
  if (!draft) return;
  Object.keys(draft.cardForm).forEach(k => {
    if (k === 'characters') {
      cardForm.characters = JSON.parse(JSON.stringify(draft.cardForm.characters));
    } else if (Array.isArray(draft.cardForm[k])) {
      cardForm[k] = [...draft.cardForm[k]];
    } else if (typeof draft.cardForm[k] ===     'object' && draft.cardForm[k] !== null) {
      cardForm[k] = { ...draft.cardForm[k] };
    } else {
      cardForm[k] = draft.cardForm[k];
    }
  });
  if (draft.results) {
    Object.keys(draft.results).forEach(k => { results[k] = draft.results[k]; });
  }
  if (draft.worldbookEntries) {
    worldbookEntries.value = JSON.parse(JSON.stringify(draft.worldbookEntries));
  }
  Object.keys(charWBGenerated).forEach(k => delete charWBGenerated[k]);
  if (draft.charWBGenerated) {
    Object.assign(charWBGenerated, draft.charWBGenerated);
  }
  if (draft.createStep != null) createStep.value = draft.createStep;
  if (draft.extraGenDone) {
    Object.keys(extraGenDone).forEach(k => { extraGenDone[k] = false; });
    Object.assign(extraGenDone, draft.extraGenDone);
  }
  showDrafts.value = false;
  toast('草稿已恢复', 'success');
}

export function deleteDraft(id) {
  drafts.value = drafts.value.filter(d => d.id !== id);
  saveDrafts();
  toast('草稿已删除', 'success');
}

export function formatDraftTime(ts) {
  try {
    const d = new Date(ts);
    return d.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  } catch { return ts; }
}

// ===== Template Editor =====
export function loadUserTemplates() {
  try {
    const raw = localStorage.getItem(TEMPLATES_KEY);
    templateEditor.templates = raw ? JSON.parse(raw) : {};
  } catch { templateEditor.templates = {}; }
}

function saveUserTemplates() {
  localStorage.setItem(TEMPLATES_KEY, JSON.stringify(templateEditor.templates));
}

export function isTemplateCustomized(name) {
  return !!(templateEditor.templates[name] && templateEditor.templates[name].modified);
}

export async function openTemplateEditor(templateName) {
  templateEditor.currentName = templateName || templateNames[0];
  templateEditor.loading = true;
  templateEditor.show = true;
  try {
    if (templateEditor.templates[templateEditor.currentName] && templateEditor.templates[templateEditor.currentName].modified) {
      templateEditor.currentContent = templateEditor.templates[templateEditor.currentName].content;
    } else {
      const res = await fetch(`/api/generate/templates/${templateEditor.currentName}`);
      if (res.ok) {
        const data = await res.json();
        templateEditor.currentContent = data.content;
      } else {
        templateEditor.currentContent = '';
        toast('模板加载失败', 'error');
      }
    }
  } catch (e) {
    templateEditor.currentContent = '';
    toast('模板加载失败: ' + e.message, 'error');
  } finally {
    templateEditor.loading = false;
  }
}

export async function switchTemplate(name) {
  templateEditor.currentName = name;
  templateEditor.loading = true;
  try {
    if (templateEditor.templates[name] && templateEditor.templates[name].modified) {
      templateEditor.currentContent = templateEditor.templates[name].content;
    } else {
      const res = await fetch(`/api/generate/templates/${name}`);
      if (res.ok) {
        const data = await res.json();
        templateEditor.currentContent = data.content;
      } else {
        templateEditor.currentContent = '';
      }
    }
  } catch {
    templateEditor.currentContent = '';
  } finally {
    templateEditor.loading = false;
  }
}

export function saveCustomTemplate() {
  const name = templateEditor.currentName;
  templateEditor.templates[name] = { content: templateEditor.currentContent, modified: true };
  saveUserTemplates();
  toast(`模板「${templateNameMap[name]}」已保存`, 'success');
}

export async function resetTemplate(name) {
  const tplName = name || templateEditor.currentName;
  try {
    const res = await fetch(`/api/generate/templates/${tplName}`);
    if (res.ok) {
      const data = await res.json();
      templateEditor.currentContent = data.content;
      delete templateEditor.templates[tplName];
      saveUserTemplates();
      toast(`模板「${templateNameMap[tplName]}」已恢复默认`, 'success');
    }
  } catch (e) {
    toast('恢复失败: ' + e.message, 'error');
  }
}

export function getCustomTemplate(step) {
  const stepToTemplate = {
    'character': 'character',
    'worldbook': 'worldbook',
    'greeting': 'greeting',
    'greeting-beautify': 'greeting-beautify',
    'mvu': 'mvu',
    'mvu-statusbar': 'mvu-statusbar',
    'status-bar': 'status-bar',
    'beautify': 'ui-beautify',
    'dialogue': 'dialogue',
    'interview': 'interview',
    'extra-requirements': 'extra-requirements',
  };
  const tplName = stepToTemplate[step] || step;
  const tpl = templateEditor.templates[tplName];
  if (tpl && tpl.modified) return tpl.content;
  return undefined;
}
