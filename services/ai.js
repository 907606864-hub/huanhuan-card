const { decrypt } = require('./crypto');

/**
 * Strip <thinking>...</thinking> blocks from AI output (prefill COT residue)
 */
function stripThinking(text) {
  // 移除完整的 <thinking>...</thinking> 块
  text = text.replace(/<thinking>[\s\S]*?<\/thinking>/gi, '');
  // 移除从开头到第一个 </thinking> 的内容（prefill 的未闭合 <thinking> 遗留）
  text = text.replace(/^[\s\S]*?<\/thinking>\s*/i, '');
  return text.trim();
}

/**
 * Call OpenAI-compatible API (streaming SSE)
 * @param {object} opts
 * @param {string} [opts.prefillCOT] - If provided, append as an assistant message to prime the model
 */
async function callAI({ apiKey, baseUrl, model, messages, prefillCOT, onChunk, onDone, onError }) {
  /* Prefill COT: append an assistant message to nudge the model */
  if (prefillCOT) {
    messages = [...messages, { role: 'assistant', content: prefillCOT }];
  }
  const url = `${baseUrl.replace(/\/+$/, '').replace(/\/v1$/i, '')}/v1/chat/completions`;
  console.log(`[AI] callAI url=${url} model=${model}`);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'User-Agent': 'HuanhuanCard/1.0',
      },
      body: JSON.stringify({
        model: model || 'gpt-4o',
        messages,
        stream: true,
        temperature: 0.8,
        max_tokens: 30000,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error(`[AI] ERROR ${response.status} from ${url}: ${errText.slice(0, 500)}`);
      throw new Error(`AI API error ${response.status}: ${errText}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let fullContent = '';
    let chunkCount = 0;
    let reasoningContent = '';
    let reasoningLogged = false;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data: ')) continue;
        
        const data = trimmed.slice(6);
        if (data === '[DONE]') {
          /* Fallback: if no content chunks but reasoning_content received, use reasoning as content */
          if (!fullContent && reasoningContent) {
            console.log(`[AI] No content received, falling back to reasoning_content (${reasoningContent.length} chars)`);
            fullContent = reasoningContent;
          }
          fullContent = stripThinking(fullContent);
          if (onDone) onDone(fullContent);
          return fullContent;
        }

        try {
          const parsed = JSON.parse(data);
          const delta = parsed.choices?.[0]?.delta;
          const content = delta?.content;
          const reasoning = delta?.reasoning_content;

          if (chunkCount === 0 && !reasoning) {
            console.log(`[AI] first chunk delta keys: ${delta ? Object.keys(delta).join(',') : 'null'}, content type: ${typeof content}, content: ${JSON.stringify(content)?.slice(0, 100)}`);
          }

          /* Handle reasoning_content (thinking models like DeepSeek R1, Gemini thinking) */
          if (reasoning) {
            reasoningContent += reasoning;
            if (!reasoningLogged) {
              console.log(`[AI] reasoning_content detected, thinking phase started`);
              reasoningLogged = true;
              /* Send a visual indicator so frontend doesn't look frozen */
              if (onChunk) onChunk('💭 AI 正在思考中...\n\n');
            }
          }

          if (content) {
            fullContent += content;
            chunkCount++;
            if (onChunk) onChunk(content);
          }
        } catch (e) {
          if (chunkCount === 0) {
            console.log(`[AI] unparseable first line: ${data.slice(0, 200)}`);
          }
        }
      }
    }

    /* Fallback: if no content chunks but reasoning_content received, use reasoning as content */
    if (!fullContent && reasoningContent) {
      console.log(`[AI] No content received (stream closed), falling back to reasoning_content (${reasoningContent.length} chars)`);
      fullContent = reasoningContent;
    }
    fullContent = stripThinking(fullContent);
    console.log(`[AI] callAI stream done. chunks=${chunkCount} resultLen=${fullContent.length} reasoningLen=${reasoningContent.length}`);
    if (onDone) onDone(fullContent);
    return fullContent;
  } catch (err) {
    console.error(`[AI] callAI exception: ${err.message}`);
    if (onError) onError(err);
    throw err;
  }
}

/**
 * Call Gemini native API (streaming SSE)
 */
async function callGeminiNative({ apiKey, baseUrl, model, messages, onChunk, onDone, onError }) {
  /* Convert messages: system → prepend to first user, assistant → model */
  var geminiContents = [];
  var systemText = '';

  for (var i = 0; i < messages.length; i++) {
    var msg = messages[i];
    if (msg.role === 'system') {
      systemText += (systemText ? '\n\n' : '') + msg.content;
    } else if (msg.role === 'assistant') {
      geminiContents.push({ role: 'model', parts: [{ text: msg.content }] });
    } else {
      /* user role */
      var text = msg.content;
      if (systemText && geminiContents.length === 0) {
        /* Prepend system text to first user message */
        text = systemText + '\n\n' + text;
        systemText = '';
      }
      geminiContents.push({ role: 'user', parts: [{ text: text }] });
    }
  }

  /* If there's leftover system text (no user message yet), add as user */
  if (systemText) {
    geminiContents.unshift({ role: 'user', parts: [{ text: systemText }] });
  }

  var cleanBase = (baseUrl || 'https://generativelanguage.googleapis.com').replace(/\/+$/, '');
  var url = cleanBase + '/v1beta/models/' + (model || 'gemini-2.0-flash') + ':streamGenerateContent?key=' + apiKey + '&alt=sse';

  var body = {
    contents: geminiContents,
    generationConfig: { temperature: 0.8, maxOutputTokens: 8192 },
    safetySettings: [
      { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
    ],
  };

  try {
    var response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'HuanhuanCard/1.0' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      var errText = await response.text();
      throw new Error('Gemini API error ' + response.status + ': ' + errText);
    }

    var reader = response.body.getReader();
    var decoder = new TextDecoder();
    var buffer = '';
    var fullContent = '';

    while (true) {
      var chunk = await reader.read();
      if (chunk.done) break;

      buffer += decoder.decode(chunk.value, { stream: true });
      var lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (var j = 0; j < lines.length; j++) {
        var line = lines[j].trim();
        if (!line || !line.startsWith('data: ')) continue;

        var dataStr = line.slice(6);
        if (dataStr === '[DONE]') {
          fullContent = stripThinking(fullContent);
          if (onDone) onDone(fullContent);
          return fullContent;
        }

        try {
          var parsed = JSON.parse(dataStr);
          var text = parsed.candidates?.[0]?.content?.parts?.[0]?.text;
          if (text) {
            fullContent += text;
            if (onChunk) onChunk(text);
          }
        } catch (e) {
          /* skip */
        }
      }
    }

    fullContent = stripThinking(fullContent);
    if (onDone) onDone(fullContent);
    return fullContent;
  } catch (err) {
    if (onError) onError(err);
    throw err;
  }
}

/**
 * Call Claude native API (streaming SSE)
 */
async function callClaudeNative({ apiKey, baseUrl, model, messages, onChunk, onDone, onError }) {
  /* Extract system messages */
  var systemParts = [];
  var claudeMessages = [];

  for (var i = 0; i < messages.length; i++) {
    var msg = messages[i];
    if (msg.role === 'system') {
      systemParts.push(msg.content);
    } else {
      claudeMessages.push({ role: msg.role, content: msg.content });
    }
  }

  var cleanBase = (baseUrl || 'https://api.anthropic.com').replace(/\/+$/, '');
  var url = cleanBase + '/v1/messages';

  var body = {
    model: model || 'claude-sonnet-4-20250514',
    max_tokens: 30000,
    stream: true,
    messages: claudeMessages,
  };

  if (systemParts.length > 0) {
    body.system = systemParts.join('\n\n');
  }

  try {
    var response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'User-Agent': 'HuanhuanCard/1.0',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      var errText = await response.text();
      throw new Error('Claude API error ' + response.status + ': ' + errText);
    }

    var reader = response.body.getReader();
    var decoder = new TextDecoder();
    var buffer = '';
    var fullContent = '';

    while (true) {
      var chunk = await reader.read();
      if (chunk.done) break;

      buffer += decoder.decode(chunk.value, { stream: true });
      var lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (var j = 0; j < lines.length; j++) {
        var line = lines[j].trim();

        if (line.startsWith('data: ')) {
          var dataStr = line.slice(6);
          try {
            var parsed = JSON.parse(dataStr);

            if (parsed.type === 'content_block_delta' && parsed.delta?.type === 'text_delta') {
              var text = parsed.delta.text;
              if (text) {
                fullContent += text;
                if (onChunk) onChunk(text);
              }
            } else if (parsed.type === 'message_stop') {
              fullContent = stripThinking(fullContent);
              if (onDone) onDone(fullContent);
              return fullContent;
            }
          } catch (e) {
            /* skip */
          }
        }
      }
    }

    fullContent = stripThinking(fullContent);
    if (onDone) onDone(fullContent);
    return fullContent;
  } catch (err) {
    if (onError) onError(err);
    throw err;
  }
}

/**
 * Router: call AI by provider
 * Routes to callAI (OpenAI compat), callGeminiNative, or callClaudeNative
 */
async function callAIByProvider({ provider, apiKey, baseUrl, model, messages, prefillCOT, onChunk, onDone, onError }) {
  if (provider === 'gemini_native') {
    return callGeminiNative({ apiKey, baseUrl, model, messages, onChunk, onDone, onError });
  }
  if (provider === 'claude_native') {
    return callClaudeNative({ apiKey, baseUrl, model, messages, onChunk, onDone, onError });
  }
  /* Default: OpenAI compatible (provider === 'openai' or unset) */
  return callAI({ apiKey, baseUrl, model, messages, prefillCOT, onChunk, onDone, onError });
}

/**
 * Call AI without streaming (returns full response)
 * @param {object} opts
 * @param {string} [opts.prefillCOT] - If provided, append as an assistant message to prime the model
 */
async function callAINonStream({ apiKey, baseUrl, model, messages, prefillCOT, provider }) {
  if (provider === 'gemini_native') {
    /* Use streaming internally but collect result */
    var result = '';
    await callGeminiNative({
      apiKey, baseUrl, model, messages,
      onChunk: function (c) { result += c; },
    });
    return stripThinking(result) || '';
  }
  if (provider === 'claude_native') {
    var result2 = '';
    await callClaudeNative({
      apiKey, baseUrl, model, messages,
      onChunk: function (c) { result2 += c; },
    });
    return stripThinking(result2) || '';
  }

  /* OpenAI compatible — use streaming internally to handle thinking models reliably */
  var result3 = await callAI({ apiKey, baseUrl, model, messages, prefillCOT });
  return result3 || '';
}

/**
 * Default prefill COT content
 */
const DEFAULT_PREFILL_COT = '<thinking>\n好的，我来仔细分析用户的需求，按照模板要求生成高质量的内容。\n';

/**
 * Determine whether to use prefill COT based on model name and user preference
 * @param {string} modelName - The model identifier
 * @param {string} userPref - 'auto' | 'on' | 'off'
 * @returns {string|null} The prefill string, or null if not applicable
 */
function resolvePrefillCOT(modelName, userPref) {
  if (userPref === 'off') return null;
  if (userPref === 'on') return DEFAULT_PREFILL_COT;

  /* Auto mode: decide by model name */
  var lower = (modelName || '').toLowerCase();
  /* Thinking models should NOT get prefill COT — they think natively */
  if (/thinking|deepseek-r|gemini-3\.1|gemini-3-pro|gemini-2\.5-pro/.test(lower)) return null;
  if (/gemini|google/.test(lower)) return DEFAULT_PREFILL_COT;
  if (/claude/.test(lower)) return null;
  /* Unknown model: default off */
  return null;
}

module.exports = { callAI, callAINonStream, callAIByProvider, callGeminiNative, callClaudeNative, resolvePrefillCOT };
