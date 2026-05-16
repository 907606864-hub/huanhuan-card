// novel.js - Novel import functions
import { novelImport, cardForm, worldbookEntries, results, previewTab, createStep, counters } from './state.js';
import { toast, detectEncoding, decodeBuffer } from './utils.js';
import { syncWorldbookToMarkdown } from './worldbook.js';

function splitChapters(text) {
  const chapterRegex = /^(第[零〇一二三四五六七八九十百千万\d]+章[^\n]*|Chapter\s+\d+[^\n]*|\d+\.\s+[^\n]+)/gm;
  const matches = [...text.matchAll(chapterRegex)];

  if (matches.length >= 3) {
    const chapters = [];
    for (let i = 0; i < matches.length; i++) {
      const start = matches[i].index;
      const end = i + 1 < matches.length ? matches[i + 1].index : text.length;
      const title = matches[i][0].trim();
      const content = text.substring(start, end).trim();
      chapters.push({ title, content });
    }
    return chapters;
  }

  const paragraphs = text.split(/\n\s*\n/).filter(p => p.trim());
  const chapters = [];
  let acc = '';
  let idx = 1;
  for (const p of paragraphs) {
    if (acc.length + p.length > 2000 && acc) {
      chapters.push({ title: `段落组 ${idx}`, content: acc.trim() });
      acc = '';
      idx++;
    }
    acc += p + '\n\n';
  }
  if (acc.trim()) {
    chapters.push({ title: `段落组 ${idx}`, content: acc.trim() });
  }
  return chapters;
}

function mergeChunks(chapters, maxSize) {
  const chunks = [];
  let current = [];
  let currentSize = 0;

  for (const ch of chapters) {
    if (currentSize + ch.content.length > maxSize && current.length > 0) {
      chunks.push(current);
      current = [];
      currentSize = 0;
    }
    current.push(ch);
    currentSize += ch.content.length;
  }
  if (current.length > 0) {
    chunks.push(current);
  }
  return chunks;
}

export function handleNovelFile(event) {
  const file = event.target.files[0];
  if (!file) return;

  novelImport.fileName = file.name;
  novelImport.fileSize = file.size;
  novelImport.error = '';
  novelImport.extractDone = false;
  novelImport.extracting = false;
  novelImport.extractedCharacters = [];
  novelImport.extractedWorldSettings = [];
  novelImport.extractedTimeline = [];
  novelImport.extractedNpcDynamics = [];
  novelImport.extractedCausalChains = [];
  novelImport.showPanel = true;

  const reader = new FileReader();
  reader.onload = (e) => {
    novelImport.rawBuffer = e.target.result;
    processNovelBuffer();
  };
  reader.readAsArrayBuffer(file);
  event.target.value = '';
}

function processNovelBuffer() {
  if (!novelImport.rawBuffer) return;

  const encoding = novelImport.encoding;
  novelImport.decodedText = decodeBuffer(novelImport.rawBuffer, encoding);
  if (encoding === 'auto') {
    novelImport.detectedEncoding = detectEncoding(novelImport.rawBuffer);
  }
  novelImport.chapters = splitChapters(novelImport.decodedText);
  novelImport.chunks = mergeChunks(novelImport.chapters, novelImport.maxChunkSize);
}

export function reDecodeNovel() {
  if (novelImport.rawBuffer) processNovelBuffer();
}

export function rechunkNovel() {
  if (novelImport.chapters.length) {
    novelImport.chunks = mergeChunks(novelImport.chapters, novelImport.maxChunkSize);
  }
}

export async function startNovelExtract() {
  if (!novelImport.chunks.length) return;

  novelImport.extracting = true;
  novelImport.extractDone = false;
  novelImport.extractProgress = 0;
  novelImport.extractCurrent = 0;
  novelImport.error = '';

  const allCharacters = [];
  const allWorldSettings = [];
  const allTimeline = [];
  const allNpcDynamics = [];
  const allCausalChains = [];

  try {
    let failedChunks = [];
    for (let i = 0; i < novelImport.chunks.length; i++) {
      novelImport.extractCurrent = i + 1;
      novelImport.extractProgress = ((i) / novelImport.chunks.length) * 100;

      const chunkText = novelImport.chunks[i].map(ch => ch.content).join('\n\n');
      const chapterRange = novelImport.chunks[i].map(ch => ch.title).join(', ');

      let chunkResult = null;
      let lastError = '';
      for (let attempt = 0; attempt < 2 && !chunkResult; attempt++) {
        if (attempt > 0) {
          novelImport.error = `块 ${i + 1} 重试中...`;
          await new Promise(r => setTimeout(r, 1000));
        }

        const res = await fetch('/api/generate/novel-extract', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chunkText,
            chunkIndex: i,
            totalChunks: novelImport.chunks.length,
            chapterRange,
            aiKeyId: cardForm.aiKeyId || undefined,
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
                if (data.result) {
                  chunkResult = data.result;
                } else if (data.error) {
                  lastError = data.error;
                }
              } catch (e) { /* ignore SSE parse errors */ }
            }
          }
        }
      }

      if (chunkResult) {
        if (chunkResult.characters) allCharacters.push(...chunkResult.characters);
        if (chunkResult.world_settings) allWorldSettings.push(...chunkResult.world_settings);
        if (chunkResult.timeline) allTimeline.push(...chunkResult.timeline);
        if (chunkResult.npc_dynamics) allNpcDynamics.push(...chunkResult.npc_dynamics);
        if (chunkResult.causal_chains) allCausalChains.push(...chunkResult.causal_chains);
      } else {
        failedChunks.push(i + 1);
        console.warn(`块 ${i + 1} 提取失败（已重试）: ${lastError}`);
      }

      novelImport.extractProgress = ((i + 1) / novelImport.chunks.length) * 100;
    }

    // Merge and deduplicate characters
    const charMap = new Map();
    for (const c of allCharacters) {
      if (!c.name) continue;
      if (charMap.has(c.name)) {
        const existing = charMap.get(c.name);
        if (c.phases && c.phases.length) {
          existing.phases = existing.phases || [];
          existing.phases.push(...c.phases);
        }
        if (c.aliases && c.aliases.length) {
          existing.aliases = existing.aliases || [];
          for (const a of c.aliases) {
            if (!existing.aliases.includes(a)) existing.aliases.push(a);
          }
        }
        if (c.departure) existing.departure = c.departure;
        if (c.first_appearance && !existing.first_appearance) existing.first_appearance = c.first_appearance;
        existing.count = (existing.count || 1) + 1;
      } else {
        charMap.set(c.name, { ...c, selected: true, count: 1, phases: c.phases || [] });
      }
    }
    novelImport.extractedCharacters = [...charMap.values()].sort((a, b) => (b.count || 0) - (a.count || 0));

    // Deduplicate world settings
    const wsMap = new Map();
    for (const w of allWorldSettings) {
      if (!w.name) continue;
      if (wsMap.has(w.name)) {
        const existing = wsMap.get(w.name);
        if (w.content && !existing.content.includes(w.content)) {
          existing.content += '\n' + w.content;
        }
      } else {
        wsMap.set(w.name, { ...w, selected: true });
      }
    }
    novelImport.extractedWorldSettings = [...wsMap.values()];

    novelImport.extractedTimeline = allTimeline;

    // NPC dynamics
    const npcMap = new Map();
    for (const n of allNpcDynamics) {
      if (!n.name) continue;
      if (npcMap.has(n.name)) {
        const existing = npcMap.get(n.name);
        existing.status = n.status;
        existing.context = n.context;
        if (n.chapter_range) existing.chapter_range += ', ' + n.chapter_range;
      } else {
        npcMap.set(n.name, { ...n });
      }
    }
    novelImport.extractedNpcDynamics = [...npcMap.values()];

    // Causal chains
    const weightOrder = { critical: 0, moderate: 1, minor: 2 };
    novelImport.extractedCausalChains = allCausalChains.sort((a, b) =>
      (weightOrder[a.narrative_weight] || 2) - (weightOrder[b.narrative_weight] || 2)
    );

    if (failedChunks.length > 0) {
      novelImport.error = `${failedChunks.length} 个块提取失败（块 ${failedChunks.join(', ')}），已跳过`;
    }

  } catch (e) {
    novelImport.error = '提取失败: ' + e.message;
  } finally {
    novelImport.extracting = false;
    novelImport.extractDone = true;
  }
}

export function generateNovelWorldbook() {
  const entries = [];

  // Characters → green (keyword-triggered)
  for (const c of novelImport.extractedCharacters) {
    if (!c.selected) continue;
    const parts = [];

    if (c.role) parts.push('定位：' + c.role);
    if (c.aliases && c.aliases.length) parts.push('别称：' + c.aliases.join('、'));
    if (c.first_appearance) parts.push('初登场：' + c.first_appearance);

    if (c.phases && c.phases.length) {
      if (c.phases.length === 1) {
        const p = c.phases[0];
        if (p.identity) parts.push('身份：' + p.identity);
        if (p.personality) parts.push('性格：' + p.personality);
        if (p.appearance) parts.push('外貌：' + p.appearance);
        if (p.emotional_state) parts.push('情感基调：' + p.emotional_state);
        if (p.relationships && p.relationships.length) {
          parts.push('关系：' + p.relationships.join('；'));
        }
      } else {
        for (let i = 0; i < c.phases.length; i++) {
          const p = c.phases[i];
          const phaseLines = [];
          if (p.identity) phaseLines.push('  身份：' + p.identity);
          if (p.personality) phaseLines.push('  性格：' + p.personality);
          if (p.appearance) phaseLines.push('  外貌：' + p.appearance);
          if (p.emotional_state) phaseLines.push('  情感基调：' + p.emotional_state);
          if (p.relationships && p.relationships.length) {
            phaseLines.push('  关系：' + p.relationships.join('；'));
          }
          if (phaseLines.length) {
            parts.push('【' + (p.period || '阶段' + (i + 1)) + '】');
            parts.push(...phaseLines);
          }
        }
      }
    }

    if (c.departure) parts.push('离场：' + c.departure);

    const keywords = [c.name];
    if (c.aliases) keywords.push(...c.aliases);

    entries.push({
      id: counters.wbEntryNextId++,
      name: c.name,
      content: parts.join('\n'),
      keywords: keywords,
      type: 'green',
      enabled: true,
    });
  }

  // World settings → blue
  for (const w of novelImport.extractedWorldSettings) {
    if (!w.selected) continue;
    const label = w.category ? '[' + w.category + '] ' : '';
    entries.push({
      id: counters.wbEntryNextId++,
      name: label + w.name,
      content: w.content || '',
      keywords: [],
      type: 'blue',
      enabled: true,
    });
  }

  // Timeline events → green
  for (const t of novelImport.extractedTimeline) {
    const keywords = t.characters_involved || [];
    const parts = [];
    if (t.period) parts.push('时间：' + t.period);
    if (t.detail) parts.push(t.detail);
    if (t.significance) parts.push('影响：' + t.significance);

    entries.push({
      id: counters.wbEntryNextId++,
      name: '事件：' + (t.event || ''),
      content: parts.join('\n'),
      keywords: keywords.length ? keywords : ['剧情'],
      type: 'green',
      enabled: true,
    });
  }

  // Causal chains → green (critical/moderate only)
  for (const cc of novelImport.extractedCausalChains) {
    if (cc.narrative_weight === 'minor') continue;
    const parts = [];
    parts.push('起因：' + (cc.trigger || ''));
    if (cc.consequences && cc.consequences.length) {
      parts.push('因果链：' + cc.consequences.join(' → '));
    }
    parts.push('重要性：' + (cc.narrative_weight === 'critical' ? '关键转折' : '推进剧情'));

    entries.push({
      id: counters.wbEntryNextId++,
      name: '因果：' + (cc.trigger || '').substring(0, 20),
      content: parts.join('\n'),
      keywords: cc.affected_characters || ['剧情'],
      type: 'green',
      enabled: true,
    });
  }

  worldbookEntries.value.push(...entries);
  syncWorldbookToMarkdown();

  previewTab.value = 'worldbook';
  createStep.value = 7;

  toast(`从小说导入了 ${entries.length} 个世界书条目`, 'success');
  novelImport.showPanel = false;
}
