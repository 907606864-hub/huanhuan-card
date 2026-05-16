/**
 * MVU Assembler Service
 * Parses AI-generated MVU content and assembles SillyTavern-compatible
 * card structures: regex_scripts, TavernHelper_scripts, character_book entries
 *
 * Reference: /opt/nova-creator-cli/build-card.js
 * Reference: /opt/nova-creator-cli/MVU组件包/
 */

const crypto = require('crypto');

/* ============================================================
 * HTML tag-closing validator / auto-fixer
 * Ensures AI-generated HTML doesn't have unclosed tags
 * ============================================================ */

const VOID_ELEMENTS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr',
]);

/**
 * Validate and auto-fix unclosed HTML tags.
 * @param {string} html - Raw HTML string
 * @param {string} label - Label for logging (e.g. '状态栏')
 * @returns {string} Fixed HTML with missing close tags appended
 */
function fixUnclosedTags(html, label) {
  if (!html) return html;

  /* 1. Fix unpaired <script>/<style> tags first */
  for (const tag of ['script', 'style']) {
    const openCount = (html.match(new RegExp(`<${tag}\\b`, 'gi')) || []).length;
    const closeCount = (html.match(new RegExp(`</${tag}>`, 'gi')) || []).length;
    if (openCount > closeCount) {
      const missing = openCount - closeCount;
      html += `</${tag}>`.repeat(missing);
      console.warn(`[mvu-assembler] ${label}: auto-closed ${missing} unpaired <${tag}> tag(s)`);
    }
  }

  /* 2. Strip paired <script>...</script>, <style>...</style>, and HTML comments
     to avoid false positives from JS/CSS angle brackets */
  const stripped = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '');

  const openStack = [];
  const tagRe = /<\/?([a-zA-Z][a-zA-Z0-9]*)\b[^>]*\/?>/g;
  let m;

  while ((m = tagRe.exec(stripped)) !== null) {
    const full = m[0];
    const tagName = m[1].toLowerCase();

    if (VOID_ELEMENTS.has(tagName)) continue;
    if (full.endsWith('/>')) continue;           /* self-closing */

    if (full.startsWith('</')) {
      /* closing tag — pop matching from stack */
      const idx = openStack.lastIndexOf(tagName);
      if (idx !== -1) openStack.splice(idx, 1);
    } else {
      /* opening tag */
      openStack.push(tagName);
    }
  }

  if (openStack.length > 0) {
    const fixes = openStack.reverse().map(t => `</${t}>`).join('');
    console.warn(`[mvu-assembler] ${label}: auto-closed ${openStack.length} unclosed tag(s): ${openStack.join(', ')}`);
    return html + fixes;
  }

  return html;
}

/* ============================================================
 * Constants — fixed templates (same for every card)
 * ============================================================ */

const SECTION_MARKERS = {
  ZOD_SCHEMA:   '---SECTION:ZOD_SCHEMA---',
  INIT_VARS:    '---SECTION:INIT_VARS---',
  UPDATE_RULES: '---SECTION:UPDATE_RULES---',
  STATUS_BAR:   '---SECTION:STATUS_BAR---',
};

/* Module 3.2 — variable output format (fixed) */
const VARIABLE_OUTPUT_FORMAT = `---
变量输出格式:
  rule:
    - you should output the update analysis and the actual update commands in the end of the next reply
    - the update commands must strictly follow the **JSON Patch (RFC 6902)** standard, but can only use the following operations: \`replace\` (replace the value of existing paths), \`add\` (only used to insert new items into an object or array), \`remove\`; that is, the output must be a valid JSON array containing operation objects
  format: |-
    <UpdateVariable>
    <Analysis>$(IN ENGLISH, no more than 80 words)
    - \${calculate time passed: ...}
    - \${decide whether dramatic updates are allowed as it's in a special case or the time passed is more than usual: yes/no}
    - \${analyze every variable based on its corresponding \`check\`, according only to current reply instead of previous plots: ...}
    </Analysis>
    <JSONPatch>
    [
      { "op": "replace", "path": "\${/path/to/variable}", "value": "\${new_value}" },
      { "op": "add", "path": "\${/path/to/object/newKey}", "value": "\${content}" },
      { "op": "remove", "path": "\${/path/to/array/0}" }
    ]
    </JSONPatch>
    </UpdateVariable>`;

/* Module 3.1 — variable list + status placeholder instruction */
const VARIABLE_LIST_INSTRUCTION = `---
当前变量状态:
{{format_message_variable::stat_data}}

请在每次发言末尾添加 <StatusPlaceHolderImpl/> 标记。`;

/* ============================================================
 * Section Parser
 * ============================================================ */

/**
 * Parse MVU AI output into 4 named sections.
 * Returns null if no valid sections found.
 */
function parseMvuSections(mvuText) {
  if (!mvuText || typeof mvuText !== 'string') return null;

  const markerEntries = Object.entries(SECTION_MARKERS);
  const positions = [];

  for (const [key, marker] of markerEntries) {
    const idx = mvuText.indexOf(marker);
    if (idx !== -1) positions.push({ key, marker, idx });
  }

  if (positions.length === 0) return null;
  positions.sort((a, b) => a.idx - b.idx);

  const sections = {};
  for (let i = 0; i < positions.length; i++) {
    const start = positions[i].idx + positions[i].marker.length;
    const end = i + 1 < positions.length ? positions[i + 1].idx : mvuText.length;
    sections[positions[i].key] = mvuText.substring(start, end).trim();
  }

  /* need at least one meaningful section */
  if (!sections.ZOD_SCHEMA && !sections.INIT_VARS) return null;

  return {
    zodSchema:   sections.ZOD_SCHEMA   || '',
    initVars:    sections.INIT_VARS    || '',
    updateRules: sections.UPDATE_RULES || '',
    statusBar:   sections.STATUS_BAR   || '',
  };
}

/* ============================================================
 * Regex Scripts (3 standard)
 * ============================================================ */

function buildRegexScripts(statusBarHtml) {
  /* Auto-fix unclosed tags in AI-generated status bar HTML */
  statusBarHtml = fixUnclosedTags(statusBarHtml, '状态栏');

  /* Strip markdown code fences that AI may have included */
  if (statusBarHtml) {
    statusBarHtml = statusBarHtml.replace(/^```(?:html|xml)?\s*\n?/i, '').replace(/\n?```\s*$/g, '').trim();
  }

  const scripts = [
    {
      id: crypto.randomUUID(),
      scriptName: '对AI隐藏状态栏',
      disabled: false,
      runOnEdit: true,
      findRegex: '<StatusPlaceHolderImpl/>',
      replaceString: '',
      trimStrings: [],
      placement: [2],
      substituteRegex: 0,
      minDepth: null,
      maxDepth: null,
      markdownOnly: false,
      promptOnly: true,
    },
    {
      id: crypto.randomUUID(),
      scriptName: '去除更新变量',
      disabled: false,
      runOnEdit: true,
      findRegex: '/<(UpdateVariable|Analysis|JSONPatch)>[\\s\\S]*?<\\/\\1>/gm',
      replaceString: '',
      trimStrings: [],
      placement: [2],
      substituteRegex: 0,
      minDepth: null,
      maxDepth: null,
      markdownOnly: true,
      promptOnly: true,
    },
  ];

  if (statusBarHtml) {
    scripts.push({
      id: crypto.randomUUID(),
      scriptName: '状态栏',
      findRegex: '<StatusPlaceHolderImpl/>',
      replaceString: '```\n' + statusBarHtml + '\n```',
      trimStrings: [],
      placement: [2],
      disabled: false,
      markdownOnly: true,
      promptOnly: false,
      runOnEdit: true,
      substituteRegex: 0,
      minDepth: null,
      maxDepth: 2,
    });
  }

  return scripts;
}

/* ============================================================
 * TavernHelper Scripts (MVU bundle + Zod Schema)
 * ============================================================ */

function buildTavernHelperScripts(zodSchemaCode) {
  const scripts = [
    {
      type: 'script',
      value: {
        id: crypto.randomUUID(),
        name: 'MVU Zod 脚本',
        content: "import 'https://testingcf.jsdelivr.net/gh/MagicalAstrogy/MagVarUpdate/artifact/bundle.js'",
        info: '',
        buttons: [
          { name: '重新处理变量', visible: false },
          { name: '重新读取初始变量', visible: false },
          { name: '清除旧楼层变量', visible: false },
        ],
        data: {
          '是否显示变量更新错误': '是',
          '构建信息': new Date().toISOString() + ' (欢欢卡站)',
        },
        enabled: true,
      },
    },
  ];

  if (zodSchemaCode) {
    scripts.push({
      type: 'script',
      value: {
        id: crypto.randomUUID(),
        name: '变量结构设计',
        content: zodSchemaCode,
        info: '',
        buttons: [],
        data: {},
        enabled: true,
      },
    });
  }

  return scripts;
}

/* ============================================================
 * Character Book Entries
 * ============================================================ */

function createEntryBase() {
  return {
    keys: [],
    secondary_keys: [],
    constant: true,
    selective: true,
    use_regex: true,
    extensions: {
      exclude_recursion: false,
      probability: 100,
      useProbability: true,
      selectiveLogic: 0,
      group: '',
      group_override: false,
      group_weight: 100,
      prevent_recursion: false,
      delay_until_recursion: false,
      scan_depth: null,
      match_whole_words: null,
      use_group_scoring: false,
      case_sensitive: null,
      automation_id: '',
      vectorized: false,
      sticky: 0,
      cooldown: 0,
      delay: 0,
    },
  };
}

function buildCharacterBookEntries({ initVars, updateRules, worldbookContent, characterName }) {
  const entries = [];
  let id = 0;

  /* Entry 0: [InitVar]初始化 — disabled, constant=false, before_char */
  if (initVars) {
    const e = createEntryBase();
    e.id = id++;
    e.keys = ['不要打开'];
    e.comment = '[InitVar]初始化';
    e.content = initVars;
    e.constant = false;
    e.enabled = false;
    e.position = 'before_char';
    e.insertion_order = 100;
    e.extensions.position = 0;
    e.extensions.display_index = e.id;
    e.extensions.depth = 4;
    e.extensions.role = 0;
    entries.push(e);
  }

  /* Entry 1: 变量更新规则 — @D system depth 1, order 1 */
  if (updateRules) {
    const e = createEntryBase();
    e.id = id++;
    e.comment = '变量更新规则';
    e.content = updateRules;
    e.enabled = true;
    e.position = 'after_char';
    e.insertion_order = 1;
    e.extensions.position = 4;
    e.extensions.display_index = e.id;
    e.extensions.depth = 1;
    e.extensions.role = 0;
    entries.push(e);
  }

  /* Entry 2: 变量处理指令集 — @D system depth 1, order 2 (fixed template) */
  {
    const e = createEntryBase();
    e.id = id++;
    e.comment = '变量处理指令集';
    e.content = VARIABLE_LIST_INSTRUCTION + '\n\n' + VARIABLE_OUTPUT_FORMAT;
    e.enabled = true;
    e.position = 'after_char';
    e.insertion_order = 2;
    e.extensions.position = 4;
    e.extensions.display_index = e.id;
    e.extensions.depth = 1;
    e.extensions.role = 0;
    entries.push(e);
  }

  /* Entry 3: 背景设定 — before_char, order 1 */
  if (worldbookContent) {
    const e = createEntryBase();
    e.id = id++;
    e.comment = '背景设定';
    e.content = worldbookContent;
    e.enabled = true;
    e.position = 'before_char';
    e.insertion_order = 1;
    e.extensions.position = 0;
    e.extensions.display_index = e.id;
    e.extensions.depth = 4;
    e.extensions.role = 0;
    entries.push(e);
  }

  return entries;
}

/* ============================================================
 * Main Entry
 * ============================================================ */

/**
 * Assemble a complete SillyTavern MVU card structure.
 *
 * @param {object} params
 * @param {string} params.mvuContent        Raw AI output with section markers
 * @param {string} params.worldbookContent  Worldbook / background text
 * @param {string} params.characterName     Character name (for book name)
 * @returns {{ regexScripts, tavernHelperScripts, characterBookEntries, characterBookName, hasMvu }}
 */
function assembleMvu({ mvuContent, worldbookContent, characterName }) {
  const sections = parseMvuSections(mvuContent);

  if (!sections) {
    /* No valid MVU — still build worldbook entry if available */
    const entries = worldbookContent
      ? buildCharacterBookEntries({ worldbookContent, characterName })
      : [];
    return {
      regexScripts: [],
      tavernHelperScripts: [],
      characterBookEntries: entries,
      characterBookName: characterName || '',
      hasMvu: false,
    };
  }

  return {
    regexScripts: buildRegexScripts(sections.statusBar),
    tavernHelperScripts: buildTavernHelperScripts(sections.zodSchema),
    characterBookEntries: buildCharacterBookEntries({
      initVars: sections.initVars,
      updateRules: sections.updateRules,
      worldbookContent,
      characterName,
    }),
    characterBookName: characterName || '',
    hasMvu: true,
  };
}

/* ============================================================
 * Non-MVU Status Bar Support
 * ============================================================ */

const NONMVU_MARKERS = {
  OUTPUT_FORMAT: '---SECTION:OUTPUT_FORMAT---',
  STATUS_BAR:   '---SECTION:STATUS_BAR---',
};

/**
 * Parse non-MVU status bar AI output into 2 named sections.
 */
function parseNonMvuSections(text) {
  if (!text || typeof text !== 'string') return null;

  const markerEntries = Object.entries(NONMVU_MARKERS);
  const positions = [];

  for (const [key, marker] of markerEntries) {
    const idx = text.indexOf(marker);
    if (idx !== -1) positions.push({ key, marker, idx });
  }

  if (positions.length === 0) return null;
  positions.sort((a, b) => a.idx - b.idx);

  const sections = {};
  for (let i = 0; i < positions.length; i++) {
    const start = positions[i].idx + positions[i].marker.length;
    const end = i + 1 < positions.length ? positions[i + 1].idx : text.length;
    sections[positions[i].key] = text.substring(start, end).trim();
  }

  return {
    outputFormat: sections.OUTPUT_FORMAT || '',
    statusBar:    sections.STATUS_BAR   || '',
  };
}

/**
 * Build worldbook-only character book entries (no MVU, no status bar).
 */
function buildWorldbookOnlyEntries({ worldbookContent, characterName }) {
  if (!worldbookContent) return [];
  const e = createEntryBase();
  e.id = 0;
  e.comment = '背景设定';
  e.content = worldbookContent;
  e.enabled = true;
  e.position = 'before_char';
  e.insertion_order = 1;
  e.extensions.position = 0;
  e.extensions.display_index = 0;
  e.extensions.depth = 4;
  e.extensions.role = 0;
  return [e];
}

/**
 * Assemble a non-MVU status bar card structure.
 *
 * @param {object} params
 * @param {string} params.statusBarContent    Raw AI output with section markers
 * @param {string} params.worldbookContent    Worldbook / background text
 * @param {string} params.characterName       Character name
 * @returns {{ regexScripts, tavernHelperScripts, characterBookEntries, characterBookName, hasMvu }}
 */
function assembleNonMvuStatusBar({ statusBarContent, worldbookContent, characterName }) {
  const sections = parseNonMvuSections(statusBarContent);

  /* If parsing fails, use the entire content as status bar HTML */
  const outputFormatText = sections?.outputFormat || '';
  const statusBarHtml_raw = fixUnclosedTags(sections?.statusBar || statusBarContent || '', '非MVU状态栏');
  /* Strip markdown code fences that AI may have included */
  const statusBarHtml = statusBarHtml_raw.replace(/^```(?:html|xml)?\s*\n?/i, '').replace(/\n?```\s*$/g, '').trim();

  const regexScripts = [];

  if (statusBarHtml) {
    /* 1. Hide StatusData from AI (promptOnly) */
    regexScripts.push({
      id: crypto.randomUUID(),
      scriptName: '对AI隐藏状态数据',
      findRegex: '/<StatusData>[\\s\\S]*?<\\/StatusData>/gm',
      replaceString: '',
      trimStrings: [],
      placement: [2],
      substituteRegex: 0,
      minDepth: null,
      maxDepth: null,
      promptOnly: true,
      markdownOnly: false,
      disabled: false,
      runOnEdit: true,
    });

    /* 2. Render status bar (markdownOnly) */
    regexScripts.push({
      id: crypto.randomUUID(),
      scriptName: '状态栏',
      findRegex: '/<StatusData>([\\s\\S]*?)<\\/StatusData>/gm',
      replaceString: '```\n<div class="huan-status-wrapper"><pre class="huan-status-data" style="display:none">$1</pre>\n' + statusBarHtml + '\n</div>\n```',
      trimStrings: [],
      placement: [2],
      substituteRegex: 0,
      minDepth: null,
      maxDepth: 2,
      promptOnly: false,
      markdownOnly: true,
      disabled: false,
      runOnEdit: true,
    });
  }

  const characterBookEntries = [];
  let entryId = 0;

  /* Entry: 状态数据输出指令 (OUTPUT_FORMAT content) */
  if (outputFormatText) {
    const e = createEntryBase();
    e.id = entryId++;
    e.comment = '状态数据输出指令';
    e.content = outputFormatText;
    e.enabled = true;
    e.position = 'after_char';
    e.insertion_order = 1;
    e.extensions.position = 4;
    e.extensions.display_index = e.id;
    e.extensions.depth = 1;
    e.extensions.role = 0;
    characterBookEntries.push(e);
  }

  /* Entry: 背景设定 (worldbook) */
  if (worldbookContent) {
    const e = createEntryBase();
    e.id = entryId++;
    e.comment = '背景设定';
    e.content = worldbookContent;
    e.enabled = true;
    e.position = 'before_char';
    e.insertion_order = 1;
    e.extensions.position = 0;
    e.extensions.display_index = e.id;
    e.extensions.depth = 4;
    e.extensions.role = 0;
    characterBookEntries.push(e);
  }

  return {
    regexScripts,
    tavernHelperScripts: [],
    characterBookEntries,
    characterBookName: characterName || '',
    hasMvu: false,
  };
}

/* ============================================================
 * Greeting Beautify Support
 * ============================================================ */

const GREETING_MARKERS = {
  GREETING_HTML: '---SECTION:GREETING_HTML---',
};

/**
 * Parse greeting beautify AI output to extract GREETING_HTML section.
 */
function parseGreetingBeautifySections(text) {
  if (!text || typeof text !== 'string') return null;

  const marker = GREETING_MARKERS.GREETING_HTML;
  const idx = text.indexOf(marker);

  if (idx === -1) {
    // No marker found — treat entire text as HTML
    return { greetingHtml: text.trim() };
  }

  const content = text.substring(idx + marker.length).trim();
  return { greetingHtml: content };
}

/**
 * Assemble greeting beautify components.
 *
 * @param {object} params
 * @param {string} params.greetingBeautifyContent  Raw AI output
 * @returns {{ greetingRegexScripts, modifiedFirstMes: function }}
 */
function assembleGreetingBeautify({ greetingBeautifyContent }) {
  const sections = parseGreetingBeautifySections(greetingBeautifyContent);
  const greetingHtml = fixUnclosedTags(sections?.greetingHtml || greetingBeautifyContent || '', '开场白美化');

  const greetingRegexScripts = [
    // 1. Hide greeting display tag from AI (promptOnly)
    {
      id: crypto.randomUUID(),
      scriptName: '对AI隐藏开场界面',
      findRegex: '<GreetingDisplay/>',
      replaceString: '',
      trimStrings: [],
      placement: [2],
      substituteRegex: 0,
      promptOnly: true,
      markdownOnly: false,
      disabled: false,
      runOnEdit: true,
      maxDepth: null,
      minDepth: null,
    },
    // 2. Render beautified greeting (markdownOnly)
    {
      id: crypto.randomUUID(),
      scriptName: '开场界面',
      findRegex: '<GreetingDisplay/>',
      replaceString: '```\n' + greetingHtml + '\n```',
      trimStrings: [],
      placement: [2],
      substituteRegex: 0,
      promptOnly: false,
      markdownOnly: true,
      disabled: false,
      runOnEdit: true,
      maxDepth: 1,
      minDepth: null,
    },
  ];

  return {
    greetingRegexScripts,
    modifiedFirstMes: (originalFirstMes) => '<GreetingDisplay/>\n' + (originalFirstMes || ''),
  };
}

module.exports = {
  assembleMvu,
  assembleNonMvuStatusBar,
  assembleGreetingBeautify,
  parseMvuSections,
  parseNonMvuSections,
  parseGreetingBeautifySections,
  buildRegexScripts,
  buildTavernHelperScripts,
  buildCharacterBookEntries,
  buildWorldbookOnlyEntries,
  createEntryBase,
  SECTION_MARKERS,
  GREETING_MARKERS,
};
