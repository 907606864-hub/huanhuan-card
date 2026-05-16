// generate.js - Generation, streaming, cover, finalize, and card operations
import { generating, streamOutput, currentGenStep, results, cardForm, previewTab, createStep,
         generatingCover, finalizing, coverPreview, coverBase64, showSuccessModal, successDownloadUrl,
         worldbookEntries, characterProgress, charWBGenerated, generatingCharWBIndex,
         generatingTags, importingCard, importedRegexScripts, importedTavernHelperScripts,
         importingCardToLibrary, editingResult, prefillCOTSetting,
         counters, stepLabels, currentView, cards, regexCustomize,
         user, apiKeys, keyForm, editingKey, modelList, fetchingModels,
         extraGenDone, autosaveStatus, autosaveAt } from './state.js';
import { toast } from './utils.js';
import { buildCharacterInput, buildWorldbookInput, buildGreetingInput,
         buildGreetingBeautifyInput, buildMvuInput, buildStatusBarInput,
         buildExtraContext } from './character.js';
import { getCustomTemplate, clearAutoDraft } from './draft.js';
import { parseWorldbookFromMarkdown, syncWorldbookToMarkdown } from './worldbook.js';

// ===== Generation =====
export async function generateStep(step) {
  // 防御性检查：characters 数组不能为空
  if (!cardForm.characters || cardForm.characters.length === 0) {
    toast('请先添加至少一个角色', 'error');
    return;
  }
  generating.value = true;
  streamOutput.value = '';
  currentGenStep.value = step;

  let input = '';
  let characterName = '';
  const _c0 = cardForm.characters[0];
  const _charName = _c0.mode === 'simple' ? _c0.nameSimple : _c0.name;

  switch (step) {
    case 'character':
      input = buildCharacterInput();
      characterName = _charName;
      break;
    case 'worldbook':
      input = buildWorldbookInput();
      characterName = _charName;
      break;
    case 'greeting':
      input = buildGreetingInput();
      characterName = _charName;
      break;
    case 'greeting-beautify':
      input = buildGreetingBeautifyInput();
      characterName = _charName;
      break;
    case 'mvu':
      input = buildMvuInput();
      characterName = _charName;
      break;
    case 'mvu-statusbar':
      input = buildStatusBarInput();
      characterName = _charName;
      break;
    case 'status-bar':
      input = buildStatusBarInput();
      characterName = _charName;
      break;
    case 'dialogue':
      input = cardForm.dialogueScenes || '';
      characterName = _charName;
      break;
    case 'interview':
      input = cardForm.interviewTopics || '';
      characterName = _charName;
      break;
    case 'extra-requirements':
      input = cardForm.extraRequirements || '';
      characterName = _charName;
      break;
    default:
      input = cardForm[step + 'Input'] || '';
  }

  if (step !== 'dialogue' && step !== 'interview' && step !== 'extra-requirements') {
    const extra = buildExtraContext();
    if (extra) input += '\n\n' + extra;
  }

  try {
    const res = await fetch('/api/generate/character', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        step,
        input: input || cardForm.characterInput,
        previousResults: { ...results },
        aiKeyId: cardForm.aiKeyId || undefined,
        characterName: characterName || cardForm.name || undefined,
        cardType: cardForm.cardType || undefined,
        prefillSetting: prefillCOTSetting.value,
        dialogueCharacter: cardForm.dialogueCharacter || undefined,
        dialogueScenes: cardForm.dialogueScenes || undefined,
        interviewCharacter: cardForm.interviewCharacter || undefined,
        interviewTopics: cardForm.interviewTopics || undefined,
        extraCharacter: cardForm.extraCharacter || undefined,
        extraRequirements: cardForm.extraRequirements || undefined,
        customTemplate: getCustomTemplate(step),
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

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const data = JSON.parse(line.slice(6));
            if (data.content && !data.step) {
              streamOutput.value += data.content;
            } else if (data.step && data.content) {
              results[step] = data.content;
            } else if (data.message) {
              toast(data.message, 'error');
            }
          } catch {}
        }
      }
    }

    if (!results[step] && streamOutput.value) {
      results[step] = streamOutput.value;
    }

    if (results[step]) {
      results[step] = results[step].replace(/<thinking>[\s\S]*?<\/thinking>/gi, '');
      results[step] = results[step].replace(/^[\s\S]*?<\/thinking>\s*/i, '');
      results[step] = results[step].trim();
    }

    if (results[step]) {
      toast(`${stepLabels[step]}生成完成`, 'success');
      // === 额外选项生成结果 → 世界书条目 ===
      if (step === 'dialogue' || step === 'interview' || step === 'extra-requirements') {
        const { syncWorldbookToMarkdown } = await import('./worldbook.js');
        const primaryCharName = characterName || cardForm.name || '';
        const targetCharName = step === 'dialogue'
          ? (cardForm.dialogueCharacter || primaryCharName)
          : step === 'interview'
            ? (cardForm.interviewCharacter || primaryCharName)
            : (cardForm.extraCharacter || primaryCharName);
        const entryNameMap = {
          'dialogue': `对话样本_${targetCharName}`,
          'interview': `深访记录_${targetCharName}`,
          'extra-requirements': cardForm.characters.length > 1 && targetCharName ? `补充设定_${targetCharName}` : `补充设定_${primaryCharName}`,
        };
        const entryName = entryNameMap[step];
        // 去重：移除同名旧条目
        const existIdx = worldbookEntries.value.findIndex(e => e.name === entryName);
        if (existIdx >= 0) worldbookEntries.value.splice(existIdx, 1);
        const keywords = [];
        if (targetCharName) keywords.push(targetCharName);
        if (primaryCharName && primaryCharName !== targetCharName) keywords.push(primaryCharName);
        if (step === 'extra-requirements') keywords.push('补充设定');
        worldbookEntries.value.push({
          id: counters.wbEntryNextId++,
          name: entryName,
          content: results[step],
          keywords: keywords,
          secondary_keys: [],
          type: 'blue',
          position: 'before_char',
          enabled: true,
          constant: true,
          selective: false,
        });
        syncWorldbookToMarkdown();
        extraGenDone[step] = true;
        delete results[step];
        previewTab.value = 'worldbook';
        toast(`已添加为世界书条目「${entryName}」`, 'info');
        createStep.value = 6;
      }
      if (step === 'worldbook') {
        const importedEntries = worldbookEntries.value.filter(e => e.imported);
        const characterEntries = worldbookEntries.value.filter(e => e.fromCharacter);
        parseWorldbookFromMarkdown();
        if (importedEntries.length > 0 || characterEntries.length > 0) {
          worldbookEntries.value = [...importedEntries, ...characterEntries, ...worldbookEntries.value];
        }
        previewTab.value = 'worldbook';
        // Auto-generate character worldbook entries for all characters
        if (cardForm.characters.length > 1) {
          toast('正在自动生成各角色世界书条目...', 'info');
          const { generateSingleCharacterWB } = await import('./worldbook.js');
          for (let i = 0; i < cardForm.characters.length; i++) {
            await generateSingleCharacterWB(i);
          }
        }
      }
      if (step === 'character' && cardForm.characters.length > 1) {
        toast(`角色设定生成完成，世界书步骤将自动为每个角色生成条目`, 'info');
      }
      // === 角色设定 → 世界书条目（单角色和多角色通用）===
      if (step === 'character') {
        const isMulti = cardForm.characters.length > 1;
        const charName = characterName || cardForm.name || '';
        const entryName = isMulti ? (cardForm.name || '角色设定') : (charName || '角色设定');
        // 删除所有旧的 fromCharacter 条目（改名后旧名的条目也会被清掉）
        worldbookEntries.value = worldbookEntries.value.filter(e => !e.fromCharacter);
        worldbookEntries.value.push({
          id: counters.wbEntryNextId++,
          name: entryName,
          content: results[step],
          keywords: isMulti ? [] : (charName ? [charName] : []),
          secondary_keys: [],
          type: 'blue',
          position: 'before_char',
          enabled: true,
          constant: true,
          selective: false,
          fromCharacter: true,
        });
        toast(`角色设定已添加为世界书条目`, 'info');
      }
      if (step !== 'dialogue' && step !== 'interview' && step !== 'extra-requirements') {
        previewTab.value = step;
      }
      const stepMap = { character: 2, worldbook: 3, greeting: 4, 'greeting-beautify': 4, mvu: 6, 'mvu-statusbar': 6, 'status-bar': 6, dialogue: 6, interview: 6, 'extra-requirements': 6 };
      if (stepMap[step] !== undefined) {
        createStep.value = stepMap[step];
      }
    }
  } catch (e) {
    toast('生成失败: ' + e.message, 'error');
  } finally {
    generating.value = false;
    characterProgress.value = { current: 0, total: 0, charName: '' };
  }
}

// ===== Stream generate helper for multi-character =====
export async function _streamGenerateCharacter(charInput, charName, isWorldbookEntry) {
  const extra = buildExtraContext();
  const fullInput = extra ? charInput + '\n\n' + extra : charInput;

  const res = await fetch('/api/generate/character', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      step: 'character',
      input: fullInput,
      previousResults: { ...results },
      aiKeyId: cardForm.aiKeyId || undefined,
      characterName: charName || undefined,
      cardType: cardForm.cardType || undefined,
      prefillSetting: prefillCOTSetting.value,
      isWorldbookEntry: !!isWorldbookEntry,
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`服务器错误 (${res.status})${errText ? ': ' + errText.slice(0, 200) : ''}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let content = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (line.startsWith('data: ')) {
        try {
          const data = JSON.parse(line.slice(6));
          if (data.content && !data.step) {
            streamOutput.value += data.content;
            content += data.content;
          } else if (data.step && data.content) {
            content = data.content;
          } else if (data.message) {
            toast(data.message, 'error');
          }
        } catch {}
      }
    }
  }

  if (content) {
    content = content.replace(/<thinking>[\s\S]*?<\/thinking>/gi, '');
    content = content.replace(/^[\s\S]*?<\/thinking>\s*/i, '');
    content = content.trim();
  }
  return content;
}

// ===== Cover =====
export async function generateCoverTags() {
  const charInfo = results.character || '';
  if (!charInfo && !cardForm.name) {
    toast('请先生成角色信息或填写角色名', 'error');
    return;
  }
  generatingTags.value = true;
  try {
    const info = charInfo || `角色名: ${cardForm.name}`;
    const res = await fetch('/api/generate/cover-tags', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        characterInfo: info,
        aiKeyId: cardForm.aiKeyId || undefined,
      }),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error);
    }
    const data = await res.json();
    cardForm.coverPrompt = data.tags;
    toast('Tag 生成成功', 'success');
  } catch (e) {
    toast('Tag 生成失败: ' + e.message, 'error');
  } finally {
    generatingTags.value = false;
  }
}

export async function generateCover() {
  if (!cardForm.coverPrompt && !results.character) {
    toast('请填写封面提示词', 'error');
    return;
  }
  generatingCover.value = true;
  try {
    const res = await fetch('/api/generate/cover', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: cardForm.coverPrompt || `anime character portrait of ${cardForm.name}`,
        imageKeyId: cardForm.imageKeyId || undefined,
      }),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error);
    }
    const blob = await res.blob();
    coverPreview.value = URL.createObjectURL(blob);

    const buf = await blob.arrayBuffer();
    const bytes = new Uint8Array(buf);
    let binary = '';
    for (let i = 0; i < bytes.length; i += 8192) {
      binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
    }
    coverBase64.value = btoa(binary);
    toast('封面生成成功', 'success');
  } catch (e) {
    toast('封面生成失败: ' + e.message, 'error');
  } finally {
    generatingCover.value = false;
  }
}

export function uploadCover(event) {
  const file = event.target.files[0];
  if (!file) return;

  const img = new Image();
  img.onload = () => {
    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    canvas.getContext('2d').drawImage(img, 0, 0);
    const pngDataUrl = canvas.toDataURL('image/png');
    coverPreview.value = pngDataUrl;
    coverBase64.value = pngDataUrl.split(',')[1];
    URL.revokeObjectURL(img.src);
    toast('封面上传成功', 'success');
  };
  img.onerror = () => {
    URL.revokeObjectURL(img.src);
    toast('图片加载失败，请换一张', 'error');
  };
  img.src = URL.createObjectURL(file);
}

export function resetCreateState() {
  Object.keys(results).forEach(k => { results[k] = ''; });
  worldbookEntries.value = [];
  cardForm.name = '';
  cardForm.workType = '';
  cardForm.aiKeyId = '';
  cardForm.characterMode = 'simple';
  cardForm.charNameSimple = '';
  cardForm.characterInput = '';
  cardForm.charRole = '';
  cardForm.charName = '';
  cardForm.charGender = '';
  cardForm.charAge = '';
  cardForm.charRace = '';
  cardForm.charHeight = '';
  cardForm.charHair = '';
  cardForm.charEyes = '';
  cardForm.charAppearance = '';
  cardForm.charOutfitDaily = '';
  cardForm.charOutfitSpecial = '';
  cardForm.charAccessories = '';
  cardForm.charPersonality = '';
  cardForm.charSpeech = '';
  cardForm.charCatchphrase = '';
  cardForm.charHabits = '';
  cardForm.charOccupation = '';
  cardForm.charBackstory = '';
  cardForm.charRelationships = '';
  cardForm.charGoals = '';
  cardForm.charFears = '';
  cardForm.charSkills = '';
  cardForm.charNotes = '';
  cardForm.characters = [{
    mode: 'simple',
    nameSimple: '', input: '',
    role: '', name: '', gender: '', age: '', race: '', height: '',
    hair: '', eyes: '', appearance: '',
    outfitDaily: '', outfitSpecial: '', accessories: '',
    personality: '', speech: '', catchphrase: '', habits: '',
    occupation: '', backstory: '', relationships: '',
    goals: '', fears: '', skills: '', notes: '',
  }];
  cardForm.worldbookMode = 'simple';
  cardForm.worldbookInput = '';
  cardForm.bgEra = '';
  cardForm.bgLocation = '';
  cardForm.bgDescription = '';
  cardForm.bgSpecialRules = '';
  cardForm.bgNotes = '';
  cardForm.greetingMode = 'simple';
  cardForm.openingScene = '';
  cardForm.openingLength = '';
  cardForm.greetingInput = '';
  cardForm.openingSpecificScene = '';
  cardForm.openingTime = '';
  cardForm.openingLocation = '';
  cardForm.openingAtmosphere = '';
  cardForm.openingUserRelation = '';
  cardForm.openingInitialConflict = '';
  cardForm.openingNotes = '';
  cardForm.needGreetingBeautify = false;
  cardForm.greetingBeautifyStyle = '毛玻璃';
  cardForm.greetingBeautifyColor = '冷色';
  cardForm.greetingBeautifyCustomPrimary = '#667eea';
  cardForm.greetingBeautifyCustomAccent = '#764ba2';
  cardForm.greetingBeautifyEffects = ['渐入动画'];
  cardForm.greetingBeautifyNotes = '';
  cardForm.needPlayer = false;
  cardForm.playerDepth = '';
  cardForm.playerOutline = '';
  cardForm.needMvu = false;
  cardForm.cardType = 'nonmvu';
  cardForm.needStatusBar = false;
  cardForm.statusBarStyle = '毛玻璃';
  cardForm.statusBarColor = '冷色';
  cardForm.statusBarCustomPrimary = '#667eea';
  cardForm.statusBarCustomAccent = '#764ba2';
  cardForm.statusBarSections = ['好感度', '位置', '内心想法'];
  cardForm.statusBarCustomSection = '';
  cardForm.statusBarEffects = ['进度条动画'];
  cardForm.statusBarNotes = '';
  cardForm.mvuComponents = [];
  cardForm.mvuVariables = [{ name: '', desc: '' }];
  cardForm.mvuStageSettings = '';
  cardForm.mvuDynamicWorld = '';
  cardForm.mvuHtmlDisplay = '';
  cardForm.mvuNotes = '';
  cardForm.mvuInput = '';
  cardForm.dialogueCharacter = '';
  cardForm.dialogueScenes = '';
  cardForm.interviewCharacter = '';
  cardForm.interviewTopics = '';
  cardForm.extraCharacter = '';
  cardForm.extraRequirements = '';
  Object.keys(extraGenDone).forEach(k => { extraGenDone[k] = false; });
  cardForm.coverPrompt = '';
  cardForm.imageKeyId = '';
  coverBase64.value = null;
  coverPreview.value = null;
  importedRegexScripts.value = [];
  importedTavernHelperScripts.value = [];
  Object.keys(regexCustomize.importPanels).forEach(k => delete regexCustomize.importPanels[k]);
  createStep.value = 1;
  previewTab.value = 'character';
  streamOutput.value = '';
  editingResult.value = null;
  Object.keys(charWBGenerated).forEach(k => delete charWBGenerated[k]);
  generatingCharWBIndex.value = -1;
  characterProgress.value = { current: 0, total: 0, charName: '' };
  clearAutoDraft();
  autosaveStatus.value = '';
  autosaveAt.value = '';
}

export async function importCard(event) {
  const file = event.target.files[0];
  if (!file) return;
  importingCard.value = true;

  try {
    const buf = await file.arrayBuffer();
    const bytes = new Uint8Array(buf);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    const imageBase64 = btoa(binary);

    const res = await fetch('/api/generate/parse-card', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageBase64 }),
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || '解析失败');
    }

    const { card, coverBase64: cover } = await res.json();
    const d = card.data || card;

    const charBook = d.character_book || d.characterBook;

    cardForm.name = d.name || '';

    if (d.description) results.character = d.description;
    if (d.first_mes) results.greeting = d.first_mes;

    if (charBook && charBook.entries && charBook.entries.length) {
      worldbookEntries.value = charBook.entries.map((e, i) => ({
        id: counters.wbEntryNextId++,
        imported: true,
        name: e.comment || '',
        content: e.content || '',
        keywords: e.keys || [],
        secondary_keys: e.secondary_keys || [],
        type: e.constant ? 'blue' : 'green',
        enabled: e.enabled !== false,
        constant: !!e.constant,
        selective: e.selective !== undefined ? e.selective : true,
        position: e.position || 'before_char',
        depth: (e.extensions && e.extensions.depth !== undefined) ? e.extensions.depth : 4,
        extensions_position: (e.extensions && e.extensions.position !== undefined) ? e.extensions.position : 0,
        insertion_order: e.insertion_order !== undefined ? e.insertion_order : i,
        role: (e.extensions && e.extensions.role !== undefined) ? e.extensions.role : 0,
      }));
      results.worldbook = worldbookEntries.value
        .map(e => (e.name ? '## ' + e.name + '\n' : '') + e.content)
        .join('\n\n');
    }

    if (d.extensions && d.extensions.regex_scripts) {
      importedRegexScripts.value = d.extensions.regex_scripts;
    }
    if (d.extensions && d.extensions.TavernHelper_scripts) {
      importedTavernHelperScripts.value = d.extensions.TavernHelper_scripts;
    }

    if (cover) {
      coverBase64.value = cover;
      coverPreview.value = 'data:image/png;base64,' + cover;
    }

    createStep.value = 6;
    const wbCount = worldbookEntries.value.length;
    const rsCount = importedRegexScripts.value.length;
    const thCount = importedTavernHelperScripts.value.length;
    const extras = [];
    if (wbCount > 0) extras.push(`${wbCount} 条世界书`);
    if (rsCount > 0) extras.push(`${rsCount} 条正则`);
    if (thCount > 0) extras.push(`${thCount} 条脚本`);
    const extraStr = extras.length ? `（含 ${extras.join('、')}）` : '';
    if (wbCount > 0) {
      previewTab.value = 'worldbook';
    } else {
      previewTab.value = 'character';
    }
    toast(`已导入角色卡「${d.name || '未命名'}」${extraStr}，可在预览区编辑后重新导出`, 'success');
  } catch (e) {
    toast('导入失败: ' + e.message, 'error');
  } finally {
    importingCard.value = false;
    event.target.value = '';
  }
}

export async function importCardToLibrary(event) {
  const file = event.target.files[0];
  if (!file) return;
  importingCardToLibrary.value = true;

  try {
    const buf = await file.arrayBuffer();
    const bytes = new Uint8Array(buf);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    const imageBase64 = btoa(binary);

    const res = await fetch('/api/cards/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageBase64 }),
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || '导入失败');
    }

    const result = await res.json();
    toast(result.message || '导入成功', 'success');

    await loadCards();

    const { startEditCard } = await import('./editor.js');
    startEditCard(result.id);
  } catch (e) {
    toast('导入失败: ' + e.message, 'error');
  } finally {
    importingCardToLibrary.value = false;
    event.target.value = '';
  }
}

export async function finalizeCard() {
  if (!cardForm.name) {
    toast('请填写作品名称', 'error');
    return;
  }
  finalizing.value = true;
  try {
    const res = await fetch('/api/generate/finalize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: cardForm.name,
        cardType: cardForm.cardType,
        characterContent: results.character,
        worldbookContent: results.worldbook,
        worldbookEntries: worldbookEntries.value.length ? worldbookEntries.value : null,
        mvuContent: cardForm.cardType === 'mvuzod' ? results.mvu : null,
        mvuStatusBarContent: cardForm.cardType === 'mvuzod' ? results['mvu-statusbar'] : null,
        statusBarContent: cardForm.needStatusBar ? results['status-bar'] : null,
        greetingContent: results.greeting,
        greetingBeautifyContent: cardForm.needGreetingBeautify ? results['greeting-beautify'] : null,
        beautifyContent: results.beautify ? { character: results.beautify } : null,
        coverImageBase64: coverBase64.value || null,
        regexScripts: importedRegexScripts.value.length ? importedRegexScripts.value : null,
        tavernHelperScripts: importedTavernHelperScripts.value.length ? importedTavernHelperScripts.value : null,
      }),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error);
    }
    const data = await res.json();
    successDownloadUrl.value = data.downloadUrl;
    showSuccessModal.value = true;
    clearAutoDraft();
    toast(data.message || '角色卡生成成功！', 'success');
    loadCards();
  } catch (e) {
    toast('打包失败: ' + e.message, 'error');
  } finally {
    finalizing.value = false;
  }
}

// ===== API Calls =====
export async function checkAuth() {
  try {
    const res = await fetch('/auth/me');
    const data = await res.json();
    Object.assign(user, data);
    if (data.loggedIn) {
      loadApiKeys();
      loadCards();
    }
  } catch (e) {
    console.error('Auth check failed:', e);
  }
}

export async function logout() {
  await fetch('/auth/logout', { method: 'POST' });
  Object.assign(user, { loggedIn: false, user: null, userId: null });
}

async function loadApiKeys() {
  try {
    const res = await fetch('/api/keys');
    apiKeys.value = await res.json();
  } catch (e) {
    toast('加载 API Key 失败', 'error');
  }
}

export async function saveApiKey() {
  try {
    const body = {
      provider: keyForm.provider,
      label: keyForm.label,
      baseUrl: keyForm.baseUrl,
      model: keyForm.model,
    };
    if (keyForm.apiKey) body.apiKey = keyForm.apiKey;

    const url = editingKey.value ? `/api/keys/${editingKey.value}` : '/api/keys';
    const method = editingKey.value ? 'PUT' : 'POST';

    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) throw new Error((await res.json()).error);

    toast(editingKey.value ? '更新成功' : '添加成功', 'success');
    Object.assign(keyForm, { provider: '', label: '', apiKey: '', baseUrl: '', model: '' });
    editingKey.value = null;
    modelList.value = [];
    loadApiKeys();
  } catch (e) {
    toast(e.message || '操作失败', 'error');
  }
}

export function editApiKey(key) {
  editingKey.value = key.id;
  modelList.value = [];
  Object.assign(keyForm, {
    provider: key.provider,
    label: key.label || '',
    apiKey: '',
    baseUrl: key.base_url || '',
    model: key.model || '',
  });
}

export function cancelEditKey() {
  editingKey.value = null;
  modelList.value = [];
  Object.assign(keyForm, { provider: '', label: '', apiKey: '', baseUrl: '', model: '' });
}

export async function fetchModels() {
  fetchingModels.value = true;
  try {
    const body = {};
    if (editingKey.value) body.keyId = editingKey.value;
    if (keyForm.apiKey) body.apiKey = keyForm.apiKey;
    if (keyForm.baseUrl) body.baseUrl = keyForm.baseUrl;
    if (keyForm.provider) body.provider = keyForm.provider;

    if (!body.apiKey && !body.keyId) {
      toast('请先填写 API Key 或保存后再拉取', 'error');
      return;
    }

    const res = await fetch('/api/keys/fetch-models', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error);
    }

    const data = await res.json();
    modelList.value = data.models || [];
    if (modelList.value.length === 0) {
      toast('没有获取到任何模型', 'error');
    } else {
      toast(`获取到 ${modelList.value.length} 个模型`, 'success');
    }
  } catch (e) {
    toast('拉取失败: ' + e.message, 'error');
  } finally {
    fetchingModels.value = false;
  }
}

export async function deleteApiKey(id) {
  if (!confirm('确定删除这个 API Key？')) return;
  try {
    await fetch(`/api/keys/${id}`, { method: 'DELETE' });
    toast('删除成功', 'success');
    loadApiKeys();
  } catch {
    toast('删除失败', 'error');
  }
}

export async function loadCards() {
  try {
    const res = await fetch('/api/cards');
    cards.value = await res.json();
  } catch {}
}

export async function deleteCard(id) {
  if (!confirm('确定删除这张角色卡？')) return;
  try {
    await fetch(`/api/cards/${id}`, { method: 'DELETE' });
    toast('删除成功', 'success');
    loadCards();
  } catch {
    toast('删除失败', 'error');
  }
}

export function toggleEditResult() {
  if (editingResult.value === previewTab.value) {
    editingResult.value = null;
  } else {
    editingResult.value = previewTab.value;
  }
}

export function goToStep(i) {
  createStep.value = i;
}

export async function generateExtraReq() {
  await generateStep('extra-requirements');
}
