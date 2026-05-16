// character.js - Character management and input building
import { cardForm, charWBGenerated, worldbookEntries } from './state.js';
import { toast } from './utils.js';

export function addCharacter() {
  cardForm.characters.push({
    mode: 'simple',
    nameSimple: '', input: '',
    role: '', name: '', gender: '', age: '', race: '', height: '',
    hair: '', eyes: '', appearance: '',
    outfitDaily: '', outfitSpecial: '', accessories: '',
    personality: '', speech: '', catchphrase: '', habits: '',
    occupation: '', backstory: '', relationships: '',
    goals: '', fears: '', skills: '', notes: '',
  });
}

export async function removeCharacter(index) {
  if (cardForm.characters.length > 1) {
    // 删除被删角色的世界书条目
    const char = cardForm.characters[index];
    const charName = char.mode === 'simple' ? char.nameSimple : char.name;
    if (charName) {
      worldbookEntries.value = worldbookEntries.value.filter(
        e => !(e.name === charName && !e.imported && !e.fromCharacter)
      );
      // 动态 import 避免 character.js ↔ worldbook.js 循环引用
      const { syncWorldbookToMarkdown } = await import('./worldbook.js');
      syncWorldbookToMarkdown();
    }
    cardForm.characters.splice(index, 1);
    const newGen = {};
    Object.keys(charWBGenerated).forEach(k => {
      const ki = Number(k);
      if (ki < index) newGen[ki] = charWBGenerated[ki];
      else if (ki > index) newGen[ki - 1] = charWBGenerated[ki];
    });
    Object.keys(charWBGenerated).forEach(k => delete charWBGenerated[k]);
    Object.assign(charWBGenerated, newGen);
  }
}

export function addVariable() {
  cardForm.mvuVariables.push({ name: '', desc: '' });
}

export function removeVariable(index) {
  cardForm.mvuVariables.splice(index, 1);
}

export function loadPresetVariables() {
  const presets = [
    { name: '世界.当前时间', desc: '格式为 yyyy年mm月dd日 星期X 上午/下午 hh:mm（24小时制），每次对话或场景转换后根据实际经历的时间自然推进' },
    { name: '世界.当前地点', desc: '具体的房间或场所名称，当角色明确移动到新地点时立即更新' },
    { name: '角色名.好感度', desc: '数值范围 0-100，初始值为0，每次对话后根据角色对{{user}}行为的感受更新，单次变化±1~5' },
    { name: '角色名.当前着装', desc: '详细描述角色当前的穿着，在起床后、洗澡后、外出前等场景需要更新' },
    { name: '角色名.当前姿势', desc: '描述角色此刻的身体姿态和动作，每次对话或场景变化时更新，反映当前状态和情绪' },
    { name: '角色名.当前想法', desc: '描述角色当前内心的真实想法，可能与外在表现不一致，每次对话后更新' },
    { name: '角色名.关系状态', desc: '描述角色与{{user}}的关系阶段，如"陌生人"、"初识"、"朋友"、"亲密"等，随着好感度变化而更新' },
  ];
  cardForm.mvuVariables = presets.map(p => ({ ...p }));
  toast(`已加载 ${presets.length} 个预设变量`, 'success');
}

export function clearAllVariables() {
  cardForm.mvuVariables = [{ name: '', desc: '' }];
  toast('已清空所有变量', 'info');
}

// ===== Build structured input text =====
export function buildCharacterInput() {
  const charTexts = cardForm.characters.map((char, idx) => {
    if (char.mode === 'simple') {
      let text = '';
      if (char.nameSimple) text += `角色名称：${char.nameSimple}\n`;
      if (char.input) text += `\n${char.input}`;
      return text.trim();
    }
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
    return parts.join('\n');
  }).filter(t => t);

  if (charTexts.length === 1) return charTexts[0];
  return charTexts.map((t, i) => `--- 角色 ${i + 1} ---\n${t}`).join('\n\n');
}

export function buildWorldbookInput() {
  if (cardForm.worldbookMode === 'simple') {
    return cardForm.worldbookInput || '';
  }
  const parts = [];
  if (cardForm.bgEra) parts.push(`时代/时期：${cardForm.bgEra}`);
  if (cardForm.bgLocation) parts.push(`主要地点：${cardForm.bgLocation}`);
  if (cardForm.bgDescription) parts.push(`背景描述：\n${cardForm.bgDescription}`);
  if (cardForm.bgSpecialRules) parts.push(`特殊规则/系统：\n${cardForm.bgSpecialRules}`);
  if (cardForm.bgNotes) parts.push(`补充说明：\n${cardForm.bgNotes}`);
  return parts.join('\n');
}

export function buildGreetingInput() {
  const parts = [];
  if (cardForm.openingScene) parts.push(`场景类型：${cardForm.openingScene}`);
  if (cardForm.openingLength) parts.push(`目标篇幅：${cardForm.openingLength}`);

  if (cardForm.greetingMode === 'simple') {
    if (cardForm.greetingInput) parts.push(`\n${cardForm.greetingInput}`);
  } else {
    if (cardForm.openingSpecificScene) parts.push(`具体场景：${cardForm.openingSpecificScene}`);
    if (cardForm.openingTime) parts.push(`时间：${cardForm.openingTime}`);
    if (cardForm.openingLocation) parts.push(`地点：${cardForm.openingLocation}`);
    if (cardForm.openingAtmosphere) parts.push(`天气/氛围：${cardForm.openingAtmosphere}`);
    if (cardForm.openingUserRelation) parts.push(`与{{user}}的关系：${cardForm.openingUserRelation}`);
    if (cardForm.openingInitialConflict) parts.push(`初始情境/冲突：\n${cardForm.openingInitialConflict}`);
    if (cardForm.openingNotes) parts.push(`补充说明：\n${cardForm.openingNotes}`);
  }
  return parts.join('\n');
}

export function buildGreetingBeautifyInput() {
  const parts = [];
  parts.push(`美化风格：${cardForm.greetingBeautifyStyle}`);
  parts.push(`配色方案：${cardForm.greetingBeautifyColor}`);
  if (cardForm.greetingBeautifyColor === '自定义') {
    parts.push(`自定义主色：${cardForm.greetingBeautifyCustomPrimary}`);
    parts.push(`自定义强调色：${cardForm.greetingBeautifyCustomAccent}`);
  }
  if (cardForm.greetingBeautifyEffects.length) {
    parts.push(`视觉效果：${cardForm.greetingBeautifyEffects.join('、')}`);
  }
  if (cardForm.greetingBeautifyNotes) {
    parts.push(`补充需求：${cardForm.greetingBeautifyNotes}`);
  }
  return parts.join('\n');
}

export function buildMvuInput() {
  if (!cardForm.needMvu) return cardForm.mvuInput || '';
  const parts = [];
  if (cardForm.mvuComponents.length) parts.push(`选用组件：${cardForm.mvuComponents.join('、')}`);

  const filledVars = cardForm.mvuVariables.filter(v => v.name);
  if (filledVars.length) {
    parts.push('需要追踪的变量：');
    filledVars.forEach((v, i) => {
      parts.push(`${i + 1}. ${v.name}：${v.desc || '（无说明）'}`);
    });
  }

  if (cardForm.mvuStageSettings) parts.push(`\n分阶段角色设定：\n${cardForm.mvuStageSettings}`);
  if (cardForm.mvuDynamicWorld) parts.push(`\n动态世界内容：\n${cardForm.mvuDynamicWorld}`);
  if (cardForm.mvuHtmlDisplay) parts.push(`\nHTML 状态栏需求：\n${cardForm.mvuHtmlDisplay}`);
  if (cardForm.mvuNotes) parts.push(`\n其他说明：\n${cardForm.mvuNotes}`);

  return parts.join('\n') || cardForm.mvuInput || '';
}

export function buildStatusBarInput() {
  const parts = [];
  parts.push(`状态栏风格：${cardForm.statusBarStyle}`);

  if (cardForm.statusBarColor === '自定义') {
    parts.push(`状态栏配色：自定义（主色 ${cardForm.statusBarCustomPrimary}，强调色 ${cardForm.statusBarCustomAccent}）`);
  } else {
    parts.push(`状态栏配色：${cardForm.statusBarColor}`);
  }

  if (cardForm.statusBarSections.length) {
    parts.push(`状态栏版块：${cardForm.statusBarSections.join('、')}`);
  }
  if (cardForm.statusBarSections.includes('自定义') && cardForm.statusBarCustomSection) {
    parts.push(`自定义版块描述：${cardForm.statusBarCustomSection}`);
  }
  if (cardForm.statusBarEffects.length) {
    parts.push(`状态栏效果：${cardForm.statusBarEffects.join('、')}`);
  }
  if (cardForm.statusBarNotes) {
    parts.push(`状态栏补充：${cardForm.statusBarNotes}`);
  }
  return parts.join('\n');
}

export function buildExtraContext() {
  const parts = [];
  if (cardForm.workType) parts.push(`作品类型：${cardForm.workType}`);

  if (cardForm.needPlayer) {
    parts.push('\n--- 玩家角色 ---');
    if (cardForm.playerDepth) parts.push(`设定深度：${cardForm.playerDepth}`);
    if (cardForm.playerOutline) parts.push(`玩家角色大纲：\n${cardForm.playerOutline}`);
  }

  if (cardForm.dialogueCharacter || cardForm.dialogueScenes) {
    parts.push('\n--- 对话补充 ---');
    if (cardForm.dialogueCharacter) parts.push(`对应角色：${cardForm.dialogueCharacter}`);
    if (cardForm.dialogueScenes) parts.push(`场景需求：${cardForm.dialogueScenes}`);
  }
  if (cardForm.interviewCharacter || cardForm.interviewTopics) {
    parts.push('\n--- 角色采访 ---');
    if (cardForm.interviewCharacter) parts.push(`对应角色：${cardForm.interviewCharacter}`);
    if (cardForm.interviewTopics) parts.push(`采访主题：\n${cardForm.interviewTopics}`);
  }
  if (cardForm.extraRequirements) {
    parts.push(`\n--- 额外需求 ---\n${cardForm.extraRequirements}`);
  }

  return parts.join('\n');
}
