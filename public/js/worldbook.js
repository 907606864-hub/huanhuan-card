// worldbook.js - Worldbook entry parsing, editing, and generation
import { worldbookEntries, results, counters, cardForm, charWBGenerated, generatingCharWBIndex,
         streamOutput, previewTab, createStep } from './state.js';
import { toast } from './utils.js';
import { buildExtraContext } from './character.js';

const { reactive, watch } = Vue;

// ===== Worldbook Entry Editor =====
export function parseXYAMLEntries(xml) {
  const entries = [];

  const outerMatch = xml.match(/^<(\w+)(?:\s+name="[^"]*")?[^>]*>([\s\S]*)<\/\1>\s*$/);
  const inner = outerMatch ? outerMatch[2] : xml;

  const tagOpenRegex = /<(\w+)\s+name="([^"]*)"[^>]*>/g;
  let match;
  const candidates = [];

  while ((match = tagOpenRegex.exec(inner)) !== null) {
    candidates.push({
      tagName: match[1],
      name: match[2],
      startIndex: match.index,
      openTagEnd: match.index + match[0].length,
    });
  }

  let skipUntil = 0;
  for (const tag of candidates) {
    if (tag.startIndex < skipUntil) continue;

    const closingTag = '</' + tag.tagName + '>';
    const closeIdx = inner.indexOf(closingTag, tag.openTagEnd);
    if (closeIdx === -1) continue;

    skipUntil = closeIdx + closingTag.length;

    const fullContent = inner.substring(tag.startIndex, skipUntil).trim();

    let activation = 'green';
    let keys = [];
    let position = 'before_char';
    let order = null;

    const activationMatch = fullContent.match(/^\s*_activation:\s*(blue|green)\s*$/m);
    if (activationMatch) activation = activationMatch[1];

    const keysMatch = fullContent.match(/^\s*_keys:\s*(.+)\s*$/m);
    if (keysMatch) {
      keys = keysMatch[1].split(/[，,]+/).map(k => k.trim()).filter(Boolean);
    }

    const positionMatch = fullContent.match(/^\s*_position:\s*(\S+)\s*$/m);
    if (positionMatch) position = positionMatch[1];

    const orderMatch = fullContent.match(/^\s*_order:\s*(\d+)\s*$/m);
    if (orderMatch) order = parseInt(orderMatch[1]);

    const cleanContent = fullContent
      .replace(/^\s*_activation:\s*.+$/m, '')
      .replace(/^\s*_keys:\s*.+$/m, '')
      .replace(/^\s*_position:\s*.+$/m, '')
      .replace(/^\s*_order:\s*.+$/m, '')
      .replace(/\n{3,}/g, '\n\n');

    if (keys.length === 0) {
      keys = tag.name.split(/[，,、\s\/]+/).filter(k => k.trim());
    }

    entries.push({
      id: counters.wbEntryNextId++,
      name: tag.name,
      content: cleanContent,
      keywords: keys,
      type: activation,
      position: position,
      insertion_order: order,
      enabled: true,
    });
  }

  return entries;
}

export function parseWorldbookFromMarkdown() {
  let md = results.worldbook || '';
  if (!md.trim()) {
    worldbookEntries.value = [];
    return;
  }

  md = md.replace(/<thinking>[\s\S]*?<\/thinking>/gi, '');
  md = md.replace(/^[\s\S]*?<\/thinking>\s*/i, '');
  md = md.trim();

  md = md.replace(/^```\w*\n?/gm, '').replace(/```\s*$/gm, '').trim();

  results.worldbook = md;

  if (/<\w+\s+name="[^"]*"/.test(md)) {
    const entries = parseXYAMLEntries(md);
    if (entries.length > 0) {
      worldbookEntries.value = entries;
      return;
    }
  }

  const entries = [];
  const parts = md.split(/^(?=## )/m);

  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;

    const headingMatch = trimmed.match(/^## (.+)/);
    let name = '';
    let content = trimmed;

    if (headingMatch) {
      name = headingMatch[1].trim();
      content = trimmed.replace(/^## .+\n?/, '').trim();
    }

    const keywords = name ? name.split(/[，,、\s\/]+/).filter(k => k.trim()) : [];

    entries.push({
      id: counters.wbEntryNextId++,
      name: name,
      content: content,
      keywords: keywords,
      type: 'green',
      enabled: true,
    });
  }

  worldbookEntries.value = entries;
}

export function syncWorldbookToMarkdown() {
  const md = worldbookEntries.value
    .filter(e => (e.name || e.content) && !e.fromCharacter && !e.imported)
    .map(e => {
      const heading = e.name ? `## ${e.name}` : '## 未命名条目';
      return `${heading}\n${e.content}`;
    })
    .join('\n\n');
  results.worldbook = md;
}

export function addWorldbookEntry() {
  worldbookEntries.value.push({
    id: counters.wbEntryNextId++,
    name: '',
    content: '',
    keywords: [],
    type: 'green',
    enabled: true,
  });
}

export function removeWorldbookEntry(idx) {
  worldbookEntries.value.splice(idx, 1);
  syncWorldbookToMarkdown();
}

export function toggleEntryType(entry) {
  entry.type = entry.type === 'green' ? 'blue' : 'green';
  syncWorldbookToMarkdown();
}

export function insertEjsCondition(idx) {
  const entry = worldbookEntries.value[idx];
  if (!entry) return;
  const rawVar = entry._ejsVar || '';
  const varName = (rawVar === '__custom__' ? (entry._ejsVarCustom || '变量名') : rawVar) || '变量名';
  const op = entry._ejsOp || '>=';
  const val = entry._ejsVal || '0';
  const isNumeric = !isNaN(Number(val));
  const getvarExpr = isNumeric ? `Number(getvar('${varName}'))` : `getvar('${varName}')`;
  const compareVal = isNumeric ? val : `'${val}'`;
  const snippet = `<% if (${getvarExpr} ${op} ${compareVal}) { %>\n在此填写满足条件时的内容\n<% } else { %>\n在此填写不满足条件时的内容\n<% } %>`;
  entry.content = (entry.content || '') + (entry.content ? '\n\n' : '') + snippet;
  syncWorldbookToMarkdown();
}

export function updateEntryKeywords(entry, val) {
  entry.keywords = val.split(/[，,]+/).map(k => k.trim()).filter(k => k);
  syncWorldbookToMarkdown();
}

export function setupWorldbookWatcher() {
  watch(() => results.worldbook, (newVal, oldVal) => {
    if (worldbookEntries.value.length === 0 && newVal) {
      parseWorldbookFromMarkdown();
    }
  });
}

// ===== Single character worldbook generation =====
export async function generateSingleCharacterWB(charIndex) {
  if (generatingCharWBIndex.value >= 0) {
    toast('正在生成中，请等待当前角色完成', 'warning');
    return;
  }
  const char = cardForm.characters[charIndex];
  if (!char) return;

  const charName = char.mode === 'simple' ? char.nameSimple : char.name;
  generatingCharWBIndex.value = charIndex;
  streamOutput.value = '';

  let charInput = '';
  if (char.mode === 'simple') {
    if (char.nameSimple) charInput += `角色名称：${char.nameSimple}\n`;
    if (char.input) charInput += `\n${char.input}`;
  } else {
    const parts = [];
    if (char.role) parts.push(`角色定位：${char.role}`);
    if (char.name) parts.push(`角色名称：${char.name}`);
    if (char.gender) parts.push(`性别：${char.gender}`);
    if (char.age) parts.push(`年龄：${char.age}`);
    if (char.race) parts.push(`种族：${char.race}`);
    if (char.height) parts.push(`身高体型：${char.height}`);
    if (char.hair) parts.push(`发型发色：${char.hair}`);
    if (char.eyes) parts.push(`眼睛：${char.eyes}`);
    if (char.appearance) parts.push(`其他外貌特征：\n${char.appearance}`);
    if (char.outfitDaily) parts.push(`日常着装：${char.outfitDaily}`);
    if (char.outfitSpecial) parts.push(`特殊场合着装：${char.outfitSpecial}`);
    if (char.accessories) parts.push(`配饰装备：\n${char.accessories}`);
    if (char.personality) parts.push(`核心性格：\n${char.personality}`);
    if (char.speech) parts.push(`说话方式：${char.speech}`);
    if (char.catchphrase) parts.push(`口头禅：${char.catchphrase}`);
    if (char.habits) parts.push(`行为习惯：\n${char.habits}`);
    if (char.occupation) parts.push(`职业/身份：${char.occupation}`);
    if (char.backstory) parts.push(`过去经历：\n${char.backstory}`);
    if (char.relationships) parts.push(`人际关系：\n${char.relationships}`);
    if (char.goals) parts.push(`目标愿望：\n${char.goals}`);
    if (char.fears) parts.push(`恐惧弱点：\n${char.fears}`);
    if (char.skills) parts.push(`技能与能力：\n${char.skills}`);
    if (char.notes) parts.push(`补充说明：\n${char.notes}`);
    charInput = parts.join('\n');
  }

  if (!charInput.trim()) {
    toast(`${charName || '角色' + (charIndex + 1)} 信息为空`, 'warning');
    generatingCharWBIndex.value = -1;
    return;
  }

  try {
    const { _streamGenerateCharacter } = await import('./generate.js');
    const content = await _streamGenerateCharacter(charInput, charName, true);
    if (content) {
      const entryName = charName || `角色${charIndex + 1}`;
      const existIdx = worldbookEntries.value.findIndex(
        e => e.name === entryName && !e.imported && !e.fromCharacter
      );
      if (existIdx >= 0) worldbookEntries.value.splice(existIdx, 1);

      const keywords = [];
      if (charName) {
        keywords.push(charName);
        if (char.name && char.nameSimple && char.name !== char.nameSimple) {
          keywords.push(char.nameSimple);
        }
      }
      worldbookEntries.value.push({
        id: counters.wbEntryNextId++,
        name: charName || `角色${charIndex + 1}`,
        content: content,
        keywords: keywords,
        secondary_keys: [],
        type: 'green',
        position: 'after_char',
        enabled: true,
        constant: false,
        selective: true,
      });
      charWBGenerated[charIndex] = true;
      previewTab.value = 'worldbook';
      syncWorldbookToMarkdown();
      toast(`${charName || '角色' + (charIndex + 1)} 世界书条目生成完成`, 'success');
    }
  } catch (e) {
    toast(`${charName || '角色' + (charIndex + 1)} 生成失败: ${e.message}`, 'error');
  } finally {
    generatingCharWBIndex.value = -1;
  }
}

export function parseWorldbookFromMarkdownSafe() {
  const imported = worldbookEntries.value.filter(e => e.imported);
  const fromChar = worldbookEntries.value.filter(e => e.fromCharacter);
  parseWorldbookFromMarkdown();
  if (imported.length > 0 || fromChar.length > 0) {
    worldbookEntries.value = [...imported, ...fromChar, ...worldbookEntries.value];
  }
}

// ===== EJS Preview Helper =====
export function ejsPreviewCode(entry) {
  const varName = entry._ejsVar === '__custom__'
    ? (entry._ejsVarCustom || '变量名')
    : (entry._ejsVar || '变量名');
  const val = entry._ejsVal || '0';
  const op = entry._ejsOp || '>=';
  const isNum = !isNaN(Number(val));
  const getExpr = isNum
    ? "Number(getvar('" + varName + "'))"
    : "getvar('" + varName + "')";
  const cmpVal = isNum ? val : "'" + val + "'";
  return '<% if (' + getExpr + ' ' + op + ' ' + cmpVal + ') { %>';
}
