const { getDb } = require('../db/init');
const { decrypt } = require('../services/crypto');
const { callAI, callAINonStream, callAIByProvider, resolvePrefillCOT } = require('../services/ai');
const fs = require('fs');
const path = require('path');
const config = require('../config');

module.exports = function (router) {

  function requireAuth(req, res, next) {
    if (!req.session.userId) return res.status(401).json({ error: '未登录' });
    next();
  }

  function getAIConfigById(userId, aiKeyId) {
    var db = getDb();
    var key = db.prepare('SELECT * FROM api_keys WHERE id = ? AND user_id = ?').get(aiKeyId, userId);
    if (!key) return null;
    return {
      provider: key.provider,
      apiKey: decrypt(key.api_key_encrypted),
      baseUrl: key.base_url,
      model: key.model,
    };
  }

  function loadTemplate(name) {
    var filePath = path.join(config.TEMPLATES_DIR, name + '.md');
    try {
      return fs.readFileSync(filePath, 'utf-8');
    } catch (e) {
      return '';
    }
  }

  /* POST /chat — SSE streaming conversation */
  router.post('/chat', requireAuth, async function (req, res) {
    var body = req.body || {};
    var messages = body.messages || [];
    var presetConfig = body.presetConfig || null;
    var aiKeyId = body.aiKeyId;
    var prefillSetting = body.prefillSetting || 'auto';

    if (!aiKeyId) {
      return res.status(400).json({ error: '请先选择 AI' });
    }

    var aiConfig = getAIConfigById(req.session.userId, aiKeyId);
    if (!aiConfig) {
      return res.status(404).json({ error: '未找到指定的 AI API Key' });
    }

    /* Build messages array */
    var systemContent = '';
    if (presetConfig && presetConfig.systemPrompt) {
      systemContent = presetConfig.systemPrompt;
    } else {
      systemContent = loadTemplate('agent-default');
    }

    var aiMessages = [];
    if (systemContent) {
      aiMessages.push({ role: 'system', content: systemContent });
    }

    /* Append conversation history */
    for (var i = 0; i < messages.length; i++) {
      aiMessages.push({
        role: messages[i].role,
        content: messages[i].content,
      });
    }

    /* Set up SSE */
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    try {
      /* Resolve prefill COT */
      var prefillCOT = resolvePrefillCOT(aiConfig.model, prefillSetting);

      await callAIByProvider({
        provider: aiConfig.provider,
        apiKey: aiConfig.apiKey,
        baseUrl: aiConfig.baseUrl,
        model: aiConfig.model,
        messages: aiMessages,
        prefillCOT: prefillCOT,
        onChunk: function (chunk) {
          res.write('data: ' + JSON.stringify({ content: chunk }) + '\n\n');
        },
        onDone: function (fullContent) {
          res.write('data: ' + JSON.stringify({ done: true, content: fullContent }) + '\n\n');
        },
        onError: function (err) {
          res.write('data: ' + JSON.stringify({ error: err.message }) + '\n\n');
        },
      });
    } catch (err) {
      res.write('data: ' + JSON.stringify({ error: err.message }) + '\n\n');
    }

    res.end();
  });

  /* POST /extract — Extract structured card data from conversation */
  router.post('/extract', requireAuth, async function (req, res) {
    var body = req.body || {};
    var messages = body.messages || [];
    var aiKeyId = body.aiKeyId;

    if (!aiKeyId) {
      return res.status(400).json({ error: '请先选择 AI' });
    }

    var aiConfig = getAIConfigById(req.session.userId, aiKeyId);
    if (!aiConfig) {
      return res.status(404).json({ error: '未找到指定的 AI API Key' });
    }

    /* Build conversation text */
    var conversationText = messages.map(function (m) {
      var label = m.role === 'user' ? '用户' : 'AI助手';
      return label + ': ' + m.content;
    }).join('\n\n');

    var extractPrompt = '你是一个数据提取器。从以下角色卡创作对话中提取结构化信息。\n\n' +
      '请严格按照以下 JSON 格式输出，不要输出其他内容：\n\n' +
      '{\n' +
      '  "name": "角色名称",\n' +
      '  "description": "完整的角色描述（包含性格、外貌、背景等，使用第三人称）",\n' +
      '  "worldbook": "世界观设定（时代、地点、规则等）",\n' +
      '  "greeting": "开场白（第一条消息，角色视角，使用{{user}}指代玩家）"\n' +
      '}\n\n' +
      '对话内容：\n' + conversationText;

    try {
      var result = await callAINonStream({
        provider: aiConfig.provider,
        apiKey: aiConfig.apiKey,
        baseUrl: aiConfig.baseUrl,
        model: aiConfig.model,
        messages: [
          { role: 'system', content: '你是一个专业的数据提取器。请从对话中提取角色卡信息，严格输出 JSON 格式，不要包含 markdown 代码块标记。' },
          { role: 'user', content: extractPrompt },
        ],
      });

      /* Parse JSON from result */
      var parsed = null;
      try {
        /* Try direct JSON parse */
        parsed = JSON.parse(result);
      } catch (e1) {
        /* Try extracting from markdown code block */
        var jsonMatch = result.match(/```(?:json)?\s*([\s\S]*?)```/);
        if (jsonMatch) {
          try {
            parsed = JSON.parse(jsonMatch[1].trim());
          } catch (e2) { /* ignore */ }
        }
        /* Try finding raw JSON object */
        if (!parsed) {
          var objMatch = result.match(/\{[\s\S]*\}/);
          if (objMatch) {
            try {
              parsed = JSON.parse(objMatch[0]);
            } catch (e3) { /* ignore */ }
          }
        }
      }

      if (!parsed) {
        return res.status(500).json({ error: 'AI 返回的数据无法解析为 JSON' });
      }

      res.json({
        name: parsed.name || '',
        character: parsed.description || '',
        worldbook: parsed.worldbook || '',
        greeting: parsed.greeting || '',
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  /* POST /refine — SSE streaming refine assistant for sidebar */
  router.post('/refine', requireAuth, async function (req, res) {
    var body = req.body || {};
    var messages = body.messages || [];
    var cardContext = body.cardContext || {};
    var field = body.field || '';
    var aiKeyId = body.aiKeyId;
    var prefillSetting = body.prefillSetting || 'auto';

    if (!aiKeyId) {
      return res.status(400).json({ error: '请先选择 AI' });
    }

    var aiConfig = getAIConfigById(req.session.userId, aiKeyId);
    if (!aiConfig) {
      return res.status(404).json({ error: '未找到指定的 AI API Key' });
    }

    /* Build context description from card results */
    var contextParts = [];
    if (cardContext.character) contextParts.push('【角色设定】\n' + cardContext.character);
    if (cardContext.worldbook) contextParts.push('【世界书】\n' + cardContext.worldbook);
    if (cardContext.greeting) contextParts.push('【开场白】\n' + cardContext.greeting);
    if (cardContext.mvu) contextParts.push('【MVU 变量系统】\n' + cardContext.mvu);
    if (cardContext['status-bar']) contextParts.push('【状态栏】\n' + cardContext['status-bar']);
    if (cardContext['greeting-beautify']) contextParts.push('【开场白美化】\n' + cardContext['greeting-beautify']);

    var cardContextStr = contextParts.join('\n\n---\n\n');

    /* Append worldbook entries metadata table if available */
    var wbEntries = cardContext._worldbookEntries;
    if (Array.isArray(wbEntries) && wbEntries.length > 0) {
      var wbTable = '【世界书条目元数据】\n| 条目名 | 关键词 | 类型 | 位置 | 常驻 | 选择性 |\n| --- | --- | --- | --- | --- | --- |\n';
      for (var wi = 0; wi < wbEntries.length; wi++) {
        var we = wbEntries[wi];
        wbTable += '| ' + (we.name || '') + ' | ' + (we.keywords || '') + ' | ' + (we.type || '') + ' | ' + (we.position || '') + ' | ' + (we.constant ? '是' : '否') + ' | ' + (we.selective ? '是' : '否') + ' |\n';
      }
      cardContextStr += '\n\n---\n\n' + wbTable;
    }

    var systemContent = '你是一个专业的 SillyTavern 角色卡调优助手。用户正在制作一张角色卡，以下是当前卡片的全部内容：\n\n' +
      cardContextStr +
      '\n\n---\n\n你的任务：根据用户的请求，帮助细化、修改或优化角色卡的某个部分。\n\n' +
      '## 修改卡片的三种方式\n\n' +
      '### 方式一：精确编辑（优先使用，省 token、更精确）\n' +
      '当只需要修改某个字段的部分内容时，使用 EditField + SearchReplace：\n' +
      '<EditField field="字段名">\n<SearchReplace>\n<Search>要替换的原文（必须与当前内容完全匹配，包括换行和空格）</Search>\n<Replace>替换后的新内容</Replace>\n</SearchReplace>\n</EditField>\n\n' +
      '一个 EditField 中可以包含多个 SearchReplace 块来批量修改。\n\n' +
      '### 方式二：全量替换（仅在大幅重写时使用）\n' +
      '<ApplyChange field="字段名">修改后的完整内容</ApplyChange>\n\n' +
      '### 方式三：修改世界书条目元数据（关键词、名称、类型等）\n' +
      '当需要修改某个世界书条目的关键词、名称、类型等结构化属性时使用：\n' +
      '<EditEntryMeta entry="条目名称">\n' +
      '  <keywords>新关键词1, 新关键词2</keywords>\n' +
      '  <name>新条目名称</name>\n' +
      '  <type>blue（普通条目）或 green（常驻条目），必须用英文</type>\n' +
      '  <position>before_char 或 after_char，必须用英文</position>\n' +
      '  <constant>true 或 false</constant>\n' +
      '  <selective>true 或 false</selective>\n' +
      '  <enabled>true 或 false</enabled>\n' +
      '</EditEntryMeta>\n\n' +
      '只写需要修改的字段，不需要改的不写。可以用多个 EditEntryMeta 修改多个条目。\n\n' +
      '## 规则\n' +
      '- 可用字段名：character, worldbook, greeting, mvu, status-bar, greeting-beautify\n' +
      '- 优先使用 EditField，只在需要重写超过 50% 内容时才用 ApplyChange\n' +
      '- Search 中的文本必须与当前卡片内容完全匹配（包括换行符和空格）\n' +
      '- 普通建议和讨论不需要使用任何标记\n' +
      '- 不要在 Search/Replace 标签内嵌套其他 XML 标签\n' +
      '- 修改世界书条目的结构化字段（关键词、类型、位置等）必须使用 EditEntryMeta，不要用 EditField 或 ApplyChange';

    var aiMessages = [{ role: 'system', content: systemContent }];

    for (var i = 0; i < messages.length; i++) {
      aiMessages.push({
        role: messages[i].role,
        content: messages[i].content,
      });
    }

    /* Set up SSE */
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    try {
      var prefillCOT = resolvePrefillCOT(aiConfig.model, prefillSetting);

      await callAIByProvider({
        provider: aiConfig.provider,
        apiKey: aiConfig.apiKey,
        baseUrl: aiConfig.baseUrl,
        model: aiConfig.model,
        messages: aiMessages,
        prefillCOT: prefillCOT,
        onChunk: function (chunk) {
          res.write('data: ' + JSON.stringify({ content: chunk }) + '\n\n');
        },
        onDone: function (fullContent) {
          res.write('data: ' + JSON.stringify({ done: true, content: fullContent }) + '\n\n');
        },
        onError: function (err) {
          res.write('data: ' + JSON.stringify({ error: err.message }) + '\n\n');
        },
      });
    } catch (err) {
      res.write('data: ' + JSON.stringify({ error: err.message }) + '\n\n');
    }

    res.end();
  });

  return router;
};
