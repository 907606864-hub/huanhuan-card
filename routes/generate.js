const { getDb } = require('../db/init');
const { decrypt } = require('../services/crypto');
const { callAI, callAIByProvider, callAINonStream, resolvePrefillCOT } = require('../services/ai');
const { generateImage } = require('../services/image');
const { buildCard, parseCharacterFromPNG } = require('../services/card-builder');
const { assembleMvu, assembleNonMvuStatusBar, buildWorldbookOnlyEntries, createEntryBase } = require('../services/mvu-assembler');

  /**
   * Extract variable paths from MVU INIT_VARS YAML section.
   * Returns a formatted string listing all _.get() paths for the status bar prompt.
   */
  function extractVarPaths(mvuText) {
    if (!mvuText || typeof mvuText !== 'string') return '';

    /* Find INIT_VARS section */
    var initStart = mvuText.indexOf('---SECTION:INIT_VARS---');
    if (initStart === -1) return '';

    var contentStart = initStart + '---SECTION:INIT_VARS---'.length;
    var nextSection = mvuText.indexOf('---SECTION:', contentStart);
    var initContent = nextSection === -1
      ? mvuText.substring(contentStart)
      : mvuText.substring(contentStart, nextSection);

    /* Strip code fence markers */
    var yaml = initContent
      .replace(/```(?:ya?ml)?\s*/gi, '')
      .replace(/```\s*/g, '')
      .trim();

    if (!yaml) return '';

    /* Parse simple YAML by indentation */
    var lines = yaml.split('\n');
    var paths = [];
    var stack = []; /* [{indent, key}] */

    for (var i = 0; i < lines.length; i++) {
      var rawLine = lines[i];
      var trimmed = rawLine.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;

      var indent = rawLine.search(/\S/);
      if (indent === -1) continue;

      var match = trimmed.match(/^([^:]+):\s*(.*)$/);
      if (!match) continue;

      var key = match[1].trim();
      var value = match[2].trim();

      /* Remove quotes */
      if ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }

      /* Pop stack to find parent at this indent level */
      while (stack.length > 0 && stack[stack.length - 1].indent >= indent) {
        stack.pop();
      }

      if (value === '' || value === '{}' || value === '[]') {
        /* Parent/object key */
        stack.push({ indent: indent, key: key });
      } else {
        /* Leaf value */
        var fullPath = stack.map(function(s) { return s.key; }).concat(key).join('.');
        var isNum = !isNaN(Number(value)) && value !== '';
        var defaultVal = isNum ? value : '"' + value + '"';
        paths.push({ path: fullPath, defaultVal: defaultVal, type: isNum ? 'number' : 'string' });
      }
    }

    if (paths.length === 0) return '';

    var result = '\n\n## 状态栏必须使用的变量路径\n\n';
    result += '以下是从 INIT_VARS 提取的所有变量路径，状态栏中 `_.get(characterData, ...)` 必须使用这些**完全一致**的路径：\n\n```\n';
    for (var j = 0; j < paths.length; j++) {
      result += "_.get(characterData, '" + paths[j].path + "', " + paths[j].defaultVal + ")  /* " + paths[j].type + " */\n";
    }
    result += '```\n\n**禁止自创路径名，必须严格使用上面列出的路径。**\n';
    return result;
  }

  /* Robust JSON parser — handles common AI output quirks */
  function robustParseJSON(raw) {
    if (!raw || !raw.trim()) return null;
    
    /* 1. Strip thinking blocks */
    let text = raw
      .replace(/<thinking>[\s\S]*?<\/thinking>/gi, '')
      .replace(/^[\s\S]*?<\/thinking>/i, '')
      .trim();
    
    /* 2. Extract from markdown code blocks */
    const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (codeBlockMatch) text = codeBlockMatch[1].trim();
    
    /* 3. Find the outermost JSON object */
    const firstBrace = text.indexOf('{');
    if (firstBrace === -1) return null;
    
    /* Find matching closing brace by counting */
    let depth = 0;
    let inStr = false;
    let escape = false;
    let lastBrace = -1;
    for (let i = firstBrace; i < text.length; i++) {
      const ch = text[i];
      if (escape) { escape = false; continue; }
      if (ch === '\\') { escape = true; continue; }
      if (ch === '"') { inStr = !inStr; continue; }
      if (inStr) continue;
      if (ch === '{') depth++;
      if (ch === '}') { depth--; if (depth === 0) { lastBrace = i; break; } }
    }
    
    if (lastBrace === -1) {
      /* Unclosed JSON — try to close it */
      text = text.substring(firstBrace) + ']}]}]}]}';
    } else {
      text = text.substring(firstBrace, lastBrace + 1);
    }
    
    /* 4. Try direct parse */
    try { return JSON.parse(text); } catch (e) { /* continue repair */ }
    
    /* 5. Repair common issues */
    let repaired = text
      /* Remove trailing commas before ] or } */
      .replace(/,\s*([\]}])/g, '$1')
      /* Remove JS comments */
      .replace(/\/\/[^\n]*/g, '')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      /* Fix unquoted keys: word: → "word": */
      .replace(/([{,]\s*)(\w+)\s*:/g, '$1"$2":')
      /* Remove control characters except \n \r \t */
      .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '')
      /* Fix single quotes used as string delimiters (crude) */
      .replace(/:\s*'([^']*)'/g, ':"$1"');
    
    try { return JSON.parse(repaired); } catch (e) { /* continue */ }
    
    /* 6. Last resort: try to extract individual arrays */
    const fallback = {};
    const arrayKeys = ['characters', 'world_settings', 'timeline', 'npc_dynamics', 'causal_chains'];
    for (const key of arrayKeys) {
      const re = new RegExp('"' + key + '"\\s*:\\s*\\[([\\s\\S]*?)\\](?=\\s*[,}])', 'i');
      const m = repaired.match(re);
      if (m) {
        try {
          const arr = JSON.parse('[' + m[1].replace(/,\s*$/, '') + ']');
          fallback[key] = arr;
        } catch (e) { /* skip this array */ }
      }
    }
    
    return Object.keys(fallback).length > 0 ? fallback : null;
  }

  /* Resolve position string to SillyTavern entry fields.
     SillyTavern extensions.position: 0=before_char, 1=after_char, 2=before_AN, 3=after_AN, 4=atDepth
     When atDepth, extensions.depth = the D value (0-4+). */
  function resolvePosition(posStr) {
    const depthMatch = posStr && posStr.match(/^D(\d+)$/i);
    if (depthMatch) {
      const d = parseInt(depthMatch[1]);
      return { position: 'before_char', extPosition: 4, depth: d, role: 0 };
    }
    if (posStr === 'after_char') {
      return { position: 'after_char', extPosition: 1, depth: 4, role: 0 };
    }
    // default: before_char
    return { position: 'before_char', extPosition: 0, depth: 4, role: 0 };
  }
const { injectHuanhuanMeta } = require('../services/card-helpers');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('../config');

module.exports = function (router) {

  function requireAuth(req, res, next) {
    if (!req.session.userId) return res.status(401).json({ error: '未登录' });
    next();
  }

  /* Get user's AI config (decrypted) */
  function getUserAIConfig(userId, providerName) {
    const db = getDb();
    const key = db.prepare('SELECT * FROM api_keys WHERE user_id = ? AND provider = ? ORDER BY updated_at DESC LIMIT 1')
      .get(userId, providerName);
    if (!key) return null;
    return {
      provider: key.provider,
      apiKey: decrypt(key.api_key_encrypted),
      baseUrl: key.base_url,
      model: key.model,
      extraConfig: JSON.parse(key.extra_config || '{}'),
    };
  }

  // Load prompt template
  function loadTemplate(name) {
    const filePath = path.join(config.TEMPLATES_DIR, `${name}.md`);
    try {
      return fs.readFileSync(filePath, 'utf-8');
    } catch {
      return '';
    }
  }

  // Get default template content (read-only, for frontend template editor)
  router.get('/templates/:name', requireAuth, (req, res) => {
    const name = req.params.name.replace(/[^a-z0-9_-]/gi, '');
    const content = loadTemplate(name);
    if (!content) return res.status(404).json({ error: '模板不存在' });
    res.json({ name, content });
  });

  // SSE: Generate character content step by step
  router.post('/character', requireAuth, async (req, res) => {
    const { step, input, previousResults, aiKeyId, imageKeyId, characterName, prefillSetting, isWorldbookEntry, customTemplate: _rawCustomTemplate } = req.body;
    const customTemplate = (typeof _rawCustomTemplate === 'string' && _rawCustomTemplate.length <= 50000) ? _rawCustomTemplate : undefined;
    
    // Set up SSE
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    const sendSSE = (event, data) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    try {
      // Get AI config
      const db = getDb();
      let aiConfig;
      if (aiKeyId) {
        const key = db.prepare('SELECT * FROM api_keys WHERE id = ? AND user_id = ?').get(aiKeyId, req.session.userId);
        if (!key) {
          sendSSE('error', { message: '未找到指定的 AI API Key' });
          return res.end();
        }
        aiConfig = {
          provider: key.provider,
          apiKey: decrypt(key.api_key_encrypted),
          baseUrl: key.base_url,
          model: key.model,
        };
      } else {
        /* Try to find any text AI key */
        aiConfig = getUserAIConfig(req.session.userId, 'openai')
          || getUserAIConfig(req.session.userId, 'gemini_native')
          || getUserAIConfig(req.session.userId, 'claude_native');
        if (!aiConfig) {
          sendSSE('error', { message: '请先配置文本 AI 的 API Key' });
          return res.end();
        }
      }

      // Build prompt based on step
      let systemPrompt = '';
      let userPrompt = '';

      switch (step) {
        case 'character': {
          const template = customTemplate || loadTemplate('character');
          const charName = characterName || '（未命名）';
          if (isWorldbookEntry) {
            systemPrompt = `你是一个专业的角色卡创作助手。你现在需要为一张多角色卡的**配角**生成世界书条目格式的角色设定。

【任务说明】
- 这不是主角，而是卡里的一个配角/NPC
- 输出的设定将作为世界书条目（keyword 触发），当角色名被提及时激活
- 使用 XYAML 格式输出，但要适合作为世界书条目（更精炼，聚焦于 AI 扮演该角色时需要的关键信息）
- 包含：基本身份、外貌描写、核心性格、说话方式、与主角/其他角色的关系
- 不需要像主角设定那么详尽，但要足够让 AI 准确扮演

【重要】角色名称必须使用「${charName}」，禁止更改。`;
            userPrompt = `${template}\n\n---\n\n这是一张多角色卡。以下是主角的角色设定（供参考关系网络）：\n${previousResults?.character || ''}\n\n现在请为配角「${charName}」生成世界书条目格式的角色设定：\n${input}`;
          } else {
            systemPrompt = `你是一个专业的角色卡创作助手。请根据用户的描述，按照模板格式生成详细的角色设定。使用 XYAML 格式输出。

【重要】角色名称必须使用用户指定的名称「${charName}」，禁止更改、替换或"优化"角色名。`;
            userPrompt = `${template}\n\n---\n\n用户指定的角色名称：「${charName}」\n\n用户的角色描述：\n${input}`;
          }
          break;
        }
        case 'worldbook': {
          const template = customTemplate || loadTemplate('worldbook');
          const hasMvu = previousResults?.mvu || (req.body.cardType === 'mvuzod');
          const mvuVarContext = previousResults?.mvu ? `\n\nMVU 变量系统（请在合适的世界书条目中使用 EJS 动态内容引用这些变量，让条目内容根据变量值动态变化）：\n${previousResults.mvu}` : '';
          const ejsHint = hasMvu ? '\n\n注意：这张卡使用了 MVU 变量系统。请在适当的世界书条目中使用 EJS 语法实现动态内容。数值比较时用 Number() 转换。只在需要根据变量状态变化的条目中使用 EJS，其余条目保持固定内容。' : '';
          systemPrompt = '你是一个专业的世界观设定创作助手。请根据角色设定和用户需求，生成对应的世界书/背景设定。使用 XYAML 格式输出。' + ejsHint;
          userPrompt = `${template}\n\n---\n\n已有的角色设定：\n${previousResults?.character || ''}${mvuVarContext}\n\n用户的补充描述：\n${input || '请根据角色设定自动生成合适的世界书'}`;
          break;
        }
        case 'mvu': {
          const mvuTemplate = customTemplate || loadTemplate('mvu');
          systemPrompt = mvuTemplate || '你是一个 MVU (MagVarUpdate) Zod 系统设计专家。请根据角色设定设计完整的 MVU 变量系统，严格按 ---SECTION:ZOD_SCHEMA---、---SECTION:INIT_VARS---、---SECTION:UPDATE_RULES--- 三段标记输出。';
          userPrompt = `已有的角色设定：\n${previousResults?.character || ''}\n\n世界书设定：\n${previousResults?.worldbook || ''}\n\n用户的补充要求：\n${input || '请根据角色设定自动设计合适的 MVU 变量系统'}`;
          break;
        }
        case 'mvu-statusbar': {
          const mvuSbTemplate = customTemplate || loadTemplate('mvu-statusbar');
          systemPrompt = mvuSbTemplate || '你是一个 SillyTavern MVU 状态栏设计专家。请根据已有的 MVU 变量系统设计 HTML 状态栏，用 ---SECTION:STATUS_BAR--- 标记输出。';
          const varPathsHint = extractVarPaths(previousResults?.mvu || '');
          userPrompt = `已有的角色设定：\n${previousResults?.character || ''}\n\n世界书设定：\n${previousResults?.worldbook || ''}\n\n已生成的 MVU 变量系统（你的状态栏必须读取这些变量）：\n${previousResults?.mvu || ''}${varPathsHint}\n\n用户的状态栏需求：\n${input || '请根据变量系统自动设计合适的状态栏'}`;
          break;
        }
        case 'greeting': {
          const template = customTemplate || loadTemplate('greeting');
          systemPrompt = '你是一个专业的角色卡开场白创作助手。请根据角色设定创作一段引人入胜的开场白。';
          userPrompt = `${template}\n\n---\n\n已有的角色设定：\n${previousResults?.character || ''}\n\n世界书设定：\n${previousResults?.worldbook || ''}\n\n用户的补充要求：\n${input || '请根据角色和世界设定自动生成开场白'}`;
          break;
        }
        case 'beautify': {
          const template = customTemplate || loadTemplate('ui-beautify');
          systemPrompt = '你是一个角色卡美化专家。请对角色卡的内容进行润色和美化，使其更加生动、专业。可以添加合适的排版格式。';
          userPrompt = `${template}\n\n---\n\n需要美化的角色卡内容：\n角色设定：${previousResults?.character || ''}\n\n世界书：${previousResults?.worldbook || ''}\n\nMVU变量：${previousResults?.mvu || ''}\n\n开场白：${previousResults?.greeting || ''}\n\n用户的美化要求：\n${input || '请全面美化角色卡内容'}`;
          break;
        }
        case 'status-bar': {
          const template = customTemplate || loadTemplate('status-bar');
          systemPrompt = template || '你是一个 SillyTavern 角色卡状态栏设计专家。请根据角色设定设计 HTML 状态栏，严格按 ---SECTION:OUTPUT_FORMAT--- 和 ---SECTION:STATUS_BAR--- 两段标记输出。';
          userPrompt = `已有的角色设定：\n${previousResults?.character || ''}\n\n世界书设定：\n${previousResults?.worldbook || ''}\n\n用户的状态栏需求：\n${input || '请根据角色设定自动设计状态栏'}`;
          break;
        }
        case 'greeting-beautify': {
          /* 根据 cardType 选择不同的美化模板：MVU 卡用 jQuery + 变量系统，非 MVU 用原生 JS */
          const isMvu = req.body.cardType === 'mvuzod';
          const templateName = isMvu ? 'greeting-beautify-mvu' : 'greeting-beautify';
          const template = customTemplate || loadTemplate(templateName);
          systemPrompt = template || '你是一个 SillyTavern 角色卡开场白界面设计专家。请将开场白内容转化为精美的 HTML 界面，严格按 ---SECTION:GREETING_HTML--- 标记输出。';
          const mvuContext = isMvu && previousResults?.mvu ? `\n\nMVU 变量系统设定（请读取这些变量来动态展示角色初始状态）：\n${previousResults.mvu}${extractVarPaths(previousResults.mvu)}` : '';
          userPrompt = `已有的角色设定：\n${previousResults?.character || ''}\n\n世界书设定：\n${previousResults?.worldbook || ''}${mvuContext}\n\n需要美化的开场白原文：\n${previousResults?.greeting || ''}\n\n用户的美化需求：\n${input || '请根据开场白内容自动设计美化界面'}`;
          break;
        }
        case 'dialogue': {
          const template = customTemplate || loadTemplate('dialogue');
          const charName = characterName || '（未命名）';
          systemPrompt = template;
          userPrompt = `已有的角色设定：\n${previousResults?.character || ''}\n\n世界书设定：\n${previousResults?.worldbook || ''}\n\n指定角色：${req.body.dialogueCharacter || charName}\n\n用户指定的场景需求：\n${req.body.dialogueScenes || '请根据角色设定自动推断最能展现角色特点的场景'}`;
          break;
        }
        case 'interview': {
          const template = customTemplate || loadTemplate('interview');
          const charName = characterName || '（未命名）';
          systemPrompt = template;
          userPrompt = `已有的角色设定：\n${previousResults?.character || ''}\n\n世界书设定：\n${previousResults?.worldbook || ''}\n\n指定角色：${req.body.interviewCharacter || charName}\n\n用户指定的采访主题：\n${req.body.interviewTopics || '请根据角色设定自动找出最值得挖掘的矛盾点和深层心理'}`;
          break;
        }
        case 'extra-requirements': {
          const template = customTemplate || loadTemplate('extra-requirements');
          systemPrompt = template;
          const extraReq = req.body.extraRequirements || '';
          const targetChar = req.body.extraCharacter || characterName || '（未命名）';
          userPrompt = `已有的角色设定：\n${previousResults?.character || ''}\n\n世界书设定：\n${previousResults?.worldbook || ''}\n\n补充目标角色：${targetChar}\n\n用户的额外需求：\n${extraReq || '请根据角色设定和世界书自动分析，补充可能遗漏的设定内容（例如：语言习惯细节、互动规则、特殊场景处理方式等）'}\n\n输出偏好：优先整理成适合写入世界书的补充设定，尽量结构化，避免和已有设定重复。`;
          break;
        }
        default:
          sendSSE('error', { message: `未知步骤: ${step}` });
          return res.end();
      }

      sendSSE('start', { step });

      /* Resolve prefill COT based on model and user setting */
      var prefillCOT = resolvePrefillCOT(aiConfig.model, prefillSetting || 'auto');

      /* Call AI with streaming */
      await callAIByProvider({
        provider: aiConfig.provider,
        apiKey: aiConfig.apiKey,
        baseUrl: aiConfig.baseUrl,
        model: aiConfig.model,
        prefillCOT: prefillCOT,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        onChunk: (chunk) => {
          sendSSE('chunk', { content: chunk });
        },
        onDone: (fullContent) => {
          sendSSE('done', { content: fullContent, step });
        },
        onError: (err) => {
          sendSSE('error', { message: err.message });
        },
      });
    } catch (err) {
      sendSSE('error', { message: err.message });
    }

    res.end();
  });

  // Generate Danbooru-style cover tags from character info using text AI
  router.post('/cover-tags', requireAuth, async (req, res) => {
    try {
      const { characterInfo, aiKeyId } = req.body;
      if (!characterInfo) return res.status(400).json({ error: '没有角色信息可供生成 tag' });

      const db = getDb();
      let aiConfig;
      if (aiKeyId) {
        const key = db.prepare('SELECT * FROM api_keys WHERE id = ? AND user_id = ?').get(aiKeyId, req.session.userId);
        if (!key) return res.status(404).json({ error: '未找到指定的 AI Key' });
        aiConfig = {
          provider: key.provider,
          apiKey: decrypt(key.api_key_encrypted),
          baseUrl: key.base_url,
          model: key.model,
          extraConfig: JSON.parse(key.extra_config || '{}'),
        };
      } else {
        aiConfig = getUserAIConfig(req.session.userId, 'openai')
          || getUserAIConfig(req.session.userId, 'gemini_native')
          || getUserAIConfig(req.session.userId, 'claude_native');
      }
      if (!aiConfig) return res.status(400).json({ error: '请先配置文本 AI Key' });

      const prompt = `Based on the following character information, generate Danbooru-style image tags for an anime character portrait. Output ONLY comma-separated tags, nothing else. Focus on: appearance (hair color/style, eye color, body type), clothing, expression, pose, and background/atmosphere.

Character info:
${characterInfo}

Tags:`;

      const { callAINonStream } = require('../services/ai');
      const result = await callAINonStream({
        provider: aiConfig.provider,
        apiKey: aiConfig.apiKey,
        baseUrl: aiConfig.baseUrl,
        model: aiConfig.model || aiConfig.extraConfig?.model,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 300,
      });

      const tags = result.replace(/^[\s\n"'`]+|[\s\n"'`]+$/g, '').replace(/\n+/g, ', ');
      res.json({ tags });
    } catch (err) {
      console.error('[COVER-TAGS] Generate failed:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // Generate cover image
  router.post('/cover', requireAuth, async (req, res) => {
    try {
      const { prompt, imageKeyId } = req.body;
      
      const db = getDb();
      let imageConfig;
      
      if (imageKeyId) {
        const key = db.prepare('SELECT * FROM api_keys WHERE id = ? AND user_id = ?').get(imageKeyId, req.session.userId);
        if (!key) return res.status(404).json({ error: '未找到指定的图片 API Key' });
        imageConfig = {
          provider: key.provider,
          apiKey: decrypt(key.api_key_encrypted),
          baseUrl: key.base_url,
          model: key.model,
          extraConfig: JSON.parse(key.extra_config || '{}'),
        };
      } else {
        // Try to find any image key
        for (const p of ['novelai', 'custom_image']) {
          imageConfig = getUserAIConfig(req.session.userId, p);
          if (imageConfig) break;
        }
        if (!imageConfig) {
          return res.status(400).json({ error: '请先配置图片生成 API Key' });
        }
      }

      const imageBuffer = await generateImage({
        provider: imageConfig.provider,
        apiKey: imageConfig.apiKey,
        baseUrl: imageConfig.baseUrl,
        prompt: prompt || 'anime character portrait, high quality',
        extraConfig: { model: imageConfig.model, ...imageConfig.extraConfig },
      });

      res.set('Content-Type', 'image/png');
      res.send(imageBuffer);
    } catch (err) {
      console.error('[COVER] Generate failed:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // Parse uploaded character card PNG → extract chara JSON
  router.post('/parse-card', requireAuth, async (req, res) => {
    try {
      const { imageBase64 } = req.body;
      if (!imageBase64) return res.status(400).json({ error: '请上传角色卡文件' });

      const buf = Buffer.from(imageBase64, 'base64');
      const cardData = parseCharacterFromPNG(buf);

      if (!cardData) {
        return res.status(400).json({ error: '未在图片中找到角色卡数据（需要包含 chara tEXt chunk 的 PNG）' });
      }

      /* 提取封面：去掉 tEXt chara chunk，保留纯图片 */
      let coverBase64 = null;
      try {
        const sharp = require('sharp');
        const pngBuf = await sharp(buf).png().toBuffer();
        coverBase64 = pngBuf.toString('base64');
      } catch (_) {
        coverBase64 = imageBase64;
      }

      res.json({ card: cardData, coverBase64 });
    } catch (err) {
      console.error('Parse card error:', err);
      res.status(400).json({ error: err.message });
    }
  });

  // SSE: Novel extract — extract characters/world/plot from a text chunk
  router.post('/novel-extract', requireAuth, async (req, res) => {
    const { chunkText, chunkIndex, totalChunks, chapterRange, aiKeyId, prefillSetting } = req.body;

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    const sendSSE = (event, data) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    try {
      const db = getDb();
      let aiConfig;
      if (aiKeyId) {
        const key = db.prepare('SELECT * FROM api_keys WHERE id = ? AND user_id = ?').get(aiKeyId, req.session.userId);
        if (!key) {
          sendSSE('error', { error: '未找到指定的 AI API Key' });
          return res.end();
        }
        aiConfig = {
          provider: key.provider,
          apiKey: decrypt(key.api_key_encrypted),
          baseUrl: key.base_url,
          model: key.model,
        };
      } else {
        aiConfig = getUserAIConfig(req.session.userId, 'openai')
          || getUserAIConfig(req.session.userId, 'gemini_native')
          || getUserAIConfig(req.session.userId, 'claude_native');
        if (!aiConfig) {
          sendSSE('error', { error: '请先配置文本 AI 的 API Key' });
          return res.end();
        }
      }

      const promptTemplate = loadTemplate('novel-extract');
      const systemPrompt = (promptTemplate || '')
        .replace(/\{\{chunkIndex\}\}/g, String(chunkIndex + 1))
        .replace(/\{\{totalChunks\}\}/g, String(totalChunks))
        .replace(/\{\{chapterRange\}\}/g, chapterRange || '未知');

      if (!systemPrompt) {
        sendSSE('error', { error: 'novel-extract 模板加载失败' });
        return res.end();
      }

      const userPrompt = `这是小说的第 ${chunkIndex + 1}/${totalChunks} 部分。
章节范围：${chapterRange}

请从以下文本中按五个维度提取信息（角色档案、时间线、NPC动态、因果链、世界观设定），严格按 JSON 格式输出。

--- 小说文本 ---
${chunkText.substring(0, 100000)}`;

      sendSSE('progress', { chunk: chunkIndex + 1, total: totalChunks });

      let fullContent = '';

      /* Novel extract MUST NOT use prefill COT — it causes models to output
         only thinking analysis without producing the required JSON.
         Force prefillCOT to null regardless of user setting. */

      await callAIByProvider({
        provider: aiConfig.provider,
        apiKey: aiConfig.apiKey,
        baseUrl: aiConfig.baseUrl,
        model: aiConfig.model,
        prefillCOT: null,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        onChunk: (chunk) => {
          fullContent += chunk;
        },
        onDone: (content) => {
          fullContent = content;
        },
        onError: (err) => {
          sendSSE('error', { error: err.message });
        },
      });

      /* Robust JSON extraction with repair */
      const result = robustParseJSON(fullContent);

      if (result) {
        sendSSE('done', { result, chunk: chunkIndex + 1 });
      } else {
        console.error(`[NOVEL-EXTRACT] 块 ${chunkIndex + 1} JSON 解析失败, 内容前200字: ${fullContent.substring(0, 200)}`);
        sendSSE('error', { error: `块 ${chunkIndex + 1} JSON 解析失败` });
      }

    } catch (err) {
      sendSSE('error', { error: err.message });
    }

    res.end();
  });

  // Regex customize: AI style rewrite for regex script HTML
  router.post('/regex-customize', requireAuth, async (req, res) => {
    const { currentHtml, scriptName, stylePreferences, aiKeyId } = req.body;

    // Set up SSE
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    const sendSSE = (event, data) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    try {
      if (!currentHtml) {
        sendSSE('error', { error: true, message: '缺少 HTML 内容' });
        return res.end();
      }

      // Get AI config
      const db = getDb();
      let aiConfig;
      if (aiKeyId) {
        const key = db.prepare('SELECT * FROM api_keys WHERE id = ? AND user_id = ?').get(aiKeyId, req.session.userId);
        if (!key) {
          sendSSE('error', { error: true, message: '未找到指定的 AI API Key' });
          return res.end();
        }
        aiConfig = {
          provider: key.provider,
          apiKey: decrypt(key.api_key_encrypted),
          baseUrl: key.base_url,
          model: key.model,
        };
      } else {
        aiConfig = getUserAIConfig(req.session.userId, 'openai')
          || getUserAIConfig(req.session.userId, 'gemini_native')
          || getUserAIConfig(req.session.userId, 'claude_native');
        if (!aiConfig) {
          sendSSE('error', { error: true, message: '请先配置文本 AI 的 API Key' });
          return res.end();
        }
      }

      const systemPrompt = loadTemplate('regex-customize');

      const prefs = stylePreferences || {};
      const prefParts = [];
      if (prefs.styles && prefs.styles.length) prefParts.push(`风格：${prefs.styles.join('、')}`);
      if (prefs.colors && prefs.colors.length) prefParts.push(`配色：${prefs.colors.join('、')}`);
      if (prefs.elements && prefs.elements.length) prefParts.push(`元素：${prefs.elements.join('、')}`);
      if (prefs.customRequest) prefParts.push(`其他要求：${prefs.customRequest}`);

      const userPrompt = `请修改以下「${scriptName || '正则脚本'}」的视觉样式。

用户的风格偏好：
${prefParts.join('\n')}

当前 HTML 代码：
\`\`\`
${currentHtml}
\`\`\``;

      sendSSE('start', { message: '开始生成...' });

      let fullText = '';
      await callAIByProvider({
        provider: aiConfig.provider,
        apiKey: aiConfig.apiKey,
        baseUrl: aiConfig.baseUrl,
        model: aiConfig.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        onChunk: (chunk) => {
          fullText += chunk;
          sendSSE('chunk', { text: chunk });
        },
        onDone: (content) => {
          sendSSE('done', { content });
        },
        onError: (err) => {
          sendSSE('error', { error: true, message: err.message });
        },
      });

    } catch (err) {
      console.error('Regex customize error:', err);
      sendSSE('error', { error: true, message: err.message || '生成失败' });
    }

    res.end();
  });

  // Finalize: build the card (PNG if cover exists, JSON otherwise)
  router.post('/finalize', requireAuth, async (req, res) => {
    try {
      const { name, cardType, characterContent, worldbookContent, worldbookEntries, mvuContent: rawMvuContent, mvuStatusBarContent, statusBarContent, greetingContent, greetingBeautifyContent, beautifyContent, coverImageBase64, regexScripts: importedRegexScripts, tavernHelperScripts: importedTavernHelperScripts } = req.body;
      /* Merge MVU variable system + separately generated status bar */
      const mvuContent = (rawMvuContent && mvuStatusBarContent)
        ? (mvuStatusBarContent.includes('---SECTION:STATUS_BAR---')
          ? rawMvuContent + '\n\n' + mvuStatusBarContent
          : rawMvuContent + '\n\n---SECTION:STATUS_BAR---\n' + mvuStatusBarContent)
        : rawMvuContent;
      
      if (!name) return res.status(400).json({ error: '角色名称不能为空' });

      const cardId = crypto.randomUUID();
      const hasCover = !!coverImageBase64;
      const ext = hasCover ? 'png' : 'json';
      const outputPath = path.join(config.CARDS_DIR, `${cardId}.${ext}`);

      // Assemble MVU / status bar / plain components
      let mvuResult;
      if (cardType === 'mvuzod' && mvuContent) {
        mvuResult = assembleMvu({
          mvuContent,
          worldbookContent: beautifyContent?.worldbook || worldbookContent || '',
          characterName: name,
        });
      } else if (statusBarContent) {
        mvuResult = assembleNonMvuStatusBar({
          statusBarContent,
          worldbookContent: beautifyContent?.worldbook || worldbookContent || '',
          characterName: name,
        });
      } else {
        // 纯非 MVU 无状态栏
        // NOTE: 不在此处处理 worldbookEntries，统一由下方 Post-process 阶段处理，避免重复生成
        const wbContent = beautifyContent?.worldbook || worldbookContent || '';
        const characterBookEntries = wbContent ? buildWorldbookOnlyEntries({ worldbookContent: wbContent, characterName: name }) : [];

        mvuResult = {
          regexScripts: [],
          tavernHelperScripts: [],
          characterBookEntries,
          characterBookName: name || '',
          hasMvu: false,
        };
      }

      /* ── Post-process: structured worldbook entries override ── */
      /* All three paths (MVU / status-bar / plain) may produce a single
         "背景设定" blob.  If the frontend sent structured entries, replace
         that blob with properly split entries while keeping other entries
         (e.g. MVU init-vars, update-rules, status-bar output-format). */
      if (worldbookEntries && Array.isArray(worldbookEntries) && worldbookEntries.length > 0) {
        const nonWbEntries = mvuResult.characterBookEntries.filter(e => e.comment !== '背景设定');
        const startId = nonWbEntries.length > 0 ? Math.max(...nonWbEntries.map(e => e.id)) + 1 : 0;
        const structuredEntries = worldbookEntries.map((entry, idx) => {
          const e = createEntryBase();
          e.id = startId + idx;
          e.comment = entry.name || `条目 ${idx + 1}`;
          e.content = entry.content || '';
          e.enabled = entry.enabled !== false;
          e.keys = entry.keywords || [];
          e.secondary_keys = entry.secondary_keys || [];
          e.constant = entry.constant !== undefined ? !!entry.constant : (entry.type === 'blue');
          e.selective = entry.selective !== undefined ? entry.selective : !e.constant;
          
          const pos = resolvePosition(entry.position);
          e.position = pos.position;
          e.extensions.position = pos.extPosition;
          e.extensions.depth = entry.depth !== undefined ? entry.depth : pos.depth;
          e.extensions.role = entry.role !== undefined ? entry.role : pos.role;
          
          e.insertion_order = entry.insertion_order !== undefined ? entry.insertion_order : idx;
          e.extensions.display_index = startId + idx;
          return e;
        });
        mvuResult.characterBookEntries = [...nonWbEntries, ...structuredEntries];
      }

      // Build character data
      const characterData = {
        name,
        description: '',
        personality: '',
        scenario: '', // worldbook goes into character_book entries now
        firstMes: beautifyContent?.greeting || greetingContent || '',
        mesExample: '',
        creatorNotes: '',
        systemPrompt: '',
        creator: req.session.discordUser?.global_name || '欢欢卡站用户',
        tags: ['欢欢卡站'],
        /* MVU components */
        regexScripts: mvuResult.regexScripts.length > 0 ? mvuResult.regexScripts : (importedRegexScripts || []),
        tavernHelperScripts: mvuResult.tavernHelperScripts.length > 0 ? mvuResult.tavernHelperScripts : (importedTavernHelperScripts || []),
        characterBook: {
          entries: mvuResult.characterBookEntries,
          name: mvuResult.characterBookName || name,
        },
      };

      /* 开场白美化处理 */
      if (greetingBeautifyContent) {
        const { assembleGreetingBeautify } = require('../services/mvu-assembler');
        const greetResult = assembleGreetingBeautify({ greetingBeautifyContent });

        /* 把美化 regex 加到已有的 regexScripts 里 */
        characterData.regexScripts = [
          ...characterData.regexScripts,
          ...greetResult.greetingRegexScripts,
        ];

        /* 修改 firstMes：在开头加标记 */
        characterData.firstMes = greetResult.modifiedFirstMes(characterData.firstMes);
      }

      /* 注入欢欢制卡机元数据 + 自动更新脚本 */
      injectHuanhuanMeta(characterData, cardId, 1);

      if (hasCover) {
        // PNG 模式：封面图 + tEXt chunk 嵌入
        let coverImage = Buffer.from(coverImageBase64, 'base64');

        /* 兜底：如果不是 PNG（前端转换失败），用 sharp 转 PNG */
        const pngSig = Buffer.from([0x89, 0x50, 0x4E, 0x47]);
        if (!coverImage.subarray(0, 4).equals(pngSig)) {
          try {
            const sharp = require('sharp');
            coverImage = await sharp(coverImage).png().toBuffer();
          } catch (sharpErr) {
            console.warn('[FINALIZE] sharp PNG conversion failed, using pngjs fallback:', sharpErr.message);
            /* pngjs 解码兜底 */
            const { PNG } = require('pngjs');
            const decoded = PNG.sync.read(coverImage);
            coverImage = PNG.sync.write(decoded);
          }
        }

        buildCard({ characterData, coverImage, outputPath });
      } else {
        // JSON 模式：直接导出角色卡 JSON
        const { buildCharacterJSON } = require('../services/card-builder');
        const cardJSON = buildCharacterJSON(characterData);
        fs.mkdirSync(path.dirname(outputPath), { recursive: true });
        fs.writeFileSync(outputPath, JSON.stringify(cardJSON, null, 2), 'utf-8');
      }

      // Save to database
      const db = getDb();
      db.prepare(`
        INSERT INTO cards (id, user_id, name, description, character_data, card_file_path, format, version, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, 1, 'completed')
      `).run(cardId, req.session.userId, name, (characterData.description || '').substring(0, 200), JSON.stringify(characterData), outputPath, ext);

      res.json({
        id: cardId,
        name,
        format: ext,
        hasMvu: mvuResult.hasMvu,
        message: hasCover
          ? (mvuResult.hasMvu ? '角色卡 PNG 生成成功！（含 MVU 变量系统）' : '角色卡 PNG 生成成功！')
          : (mvuResult.hasMvu ? '角色卡 JSON 生成成功！（含 MVU 变量系统）' : '角色卡 JSON 生成成功！'),
        downloadUrl: `/api/cards/${cardId}/download`,
      });
    } catch (err) {
      console.error('Card build error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  return router;
};
