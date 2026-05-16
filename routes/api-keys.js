const { getDb } = require('../db/init');
const { encrypt, decrypt } = require('../services/crypto');

module.exports = function (router) {

  // Auth middleware
  function requireAuth(req, res, next) {
    if (!req.session.userId) return res.status(401).json({ error: '未登录' });
    next();
  }

  // List user's API keys (decrypted key is masked)
  router.get('/', requireAuth, (req, res) => {
    const db = getDb();
    const keys = db.prepare('SELECT id, provider, label, base_url, model, extra_config, created_at FROM api_keys WHERE user_id = ? ORDER BY created_at DESC')
      .all(req.session.userId);
    res.json(keys);
  });

  /* Fetch model list — adapts to provider */
  router.post('/fetch-models', requireAuth, async (req, res) => {
    try {
      const { apiKey, baseUrl, keyId, provider } = req.body;
      console.log(`[FETCH-MODELS] Request: keyId=${keyId || 'none'}, hasApiKey=${!!apiKey}, baseUrl=${baseUrl || 'default'}, provider=${provider || 'auto'}`);
      let finalKey = apiKey;
      let finalUrl = baseUrl;
      let finalProvider = provider || 'openai';

      /* If keyId is provided, use existing key from DB */
      if (keyId && !apiKey) {
        const db = getDb();
        const existing = db.prepare('SELECT api_key_encrypted, base_url, provider FROM api_keys WHERE id = ? AND user_id = ?')
          .get(keyId, req.session.userId);
        if (!existing) return res.status(404).json({ error: '未找到该 Key' });
        finalKey = decrypt(existing.api_key_encrypted);
        if (!finalUrl) finalUrl = existing.base_url;
        if (!provider) finalProvider = existing.provider;
      }

      if (!finalKey) return res.status(400).json({ error: '请提供 API Key' });

      /* NovelAI: no list API, return built-in models */
      if (finalProvider === 'novelai') {
        var novelaiModels = [
          { id: 'nai-diffusion-4-5-full', owned_by: 'novelai' },
          { id: 'nai-diffusion-4-5-curated', owned_by: 'novelai' },
          { id: 'nai-diffusion-4-full', owned_by: 'novelai' },
          { id: 'nai-diffusion-4-curated-preview', owned_by: 'novelai' },
          { id: 'nai-diffusion-3', owned_by: 'novelai' },
        ];
        return res.json({ models: novelaiModels });
      }

      /* Claude native: no list API, return preset models */
      if (finalProvider === 'claude_native') {
        var claudeModels = [
          { id: 'claude-sonnet-4-20250514', owned_by: 'anthropic' },
          { id: 'claude-opus-4-20250514', owned_by: 'anthropic' },
          { id: 'claude-3-5-haiku-20241022', owned_by: 'anthropic' },
        ];
        return res.json({ models: claudeModels });
      }

      /* Gemini native: different API format */
      if (finalProvider === 'gemini_native') {
        if (!finalUrl) finalUrl = 'https://generativelanguage.googleapis.com';
        var cleanGeminiUrl = finalUrl.replace(/\/+$/, '');
        var geminiModelsUrl = cleanGeminiUrl + '/v1beta/models?key=' + finalKey;
        console.log('[FETCH-MODELS] Fetching Gemini: ' + geminiModelsUrl.replace(finalKey, '***'));

        var geminiController = new AbortController();
        var geminiTimeout = setTimeout(function () { geminiController.abort(); }, 15000);

        var geminiRes = await fetch(geminiModelsUrl, { signal: geminiController.signal, headers: { 'User-Agent': 'HuanhuanCard/1.0' } });
        clearTimeout(geminiTimeout);

        if (!geminiRes.ok) {
          var geminiErrText = await geminiRes.text().catch(function () { return ''; });
          return res.status(geminiRes.status).json({ error: '模型列表拉取失败 (' + geminiRes.status + '): ' + geminiErrText.substring(0, 200) });
        }

        var geminiData = await geminiRes.json();
        var geminiModels = (geminiData.models || [])
          .filter(function (m) {
            return m.name && m.supportedGenerationMethods && m.supportedGenerationMethods.includes('generateContent');
          })
          .map(function (m) {
            return {
              id: m.name.replace(/^models\//, ''),
              owned_by: 'google',
            };
          })
          .sort(function (a, b) { return a.id.localeCompare(b.id); });

        return res.json({ models: geminiModels });
      }

      /* OpenAI compatible */
      if (!finalUrl) finalUrl = 'https://api.openai.com';

      /* Normalize URL — strip trailing /v1 or /v1/ to avoid double /v1/v1 */
      const cleanUrl = finalUrl.replace(/\/+$/, '').replace(/\/v1$/, '');
      const modelsUrl = cleanUrl + '/v1/models';
      console.log(`[FETCH-MODELS] Fetching: ${modelsUrl}`);

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);

      const response = await fetch(modelsUrl, {
        headers: { 'Authorization': `Bearer ${finalKey}`, 'User-Agent': 'HuanhuanCard/1.0' },
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!response.ok) {
        const text = await response.text().catch(() => '');
        return res.status(response.status).json({ error: `模型列表拉取失败 (${response.status}): ${text.substring(0, 200)}` });
      }

      const data = await response.json();
      const models = (data.data || []).map(m => ({
        id: m.id,
        owned_by: m.owned_by || '',
      })).sort((a, b) => a.id.localeCompare(b.id));

      res.json({ models });
    } catch (err) {
      if (err.name === 'AbortError') {
        return res.status(504).json({ error: '请求超时（15s）' });
      }
      res.status(500).json({ error: err.message });
    }
  });

  // Add API key
  router.post('/', requireAuth, (req, res) => {
    const { provider, label, apiKey, baseUrl, model, extraConfig } = req.body;
    if (!provider || !apiKey) {
      return res.status(400).json({ error: '缺少必填字段' });
    }

    const db = getDb();
    const encrypted = encrypt(apiKey);

    const result = db.prepare(`
      INSERT INTO api_keys (user_id, provider, label, api_key_encrypted, base_url, model, extra_config)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(req.session.userId, provider, label || '', encrypted, baseUrl || '', model || '', JSON.stringify(extraConfig || {}));

    res.json({ id: result.lastInsertRowid, message: '添加成功' });
  });

  // Update API key
  router.put('/:id', requireAuth, (req, res) => {
    const { provider, label, apiKey, baseUrl, model, extraConfig } = req.body;
    const db = getDb();

    // Verify ownership
    const existing = db.prepare('SELECT id FROM api_keys WHERE id = ? AND user_id = ?').get(req.params.id, req.session.userId);
    if (!existing) return res.status(404).json({ error: '未找到' });

    if (apiKey) {
      const encrypted = encrypt(apiKey);
      db.prepare(`
        UPDATE api_keys SET provider=?, label=?, api_key_encrypted=?, base_url=?, model=?, extra_config=?, updated_at=CURRENT_TIMESTAMP
        WHERE id=? AND user_id=?
      `).run(provider, label || '', encrypted, baseUrl || '', model || '', JSON.stringify(extraConfig || {}), req.params.id, req.session.userId);
    } else {
      db.prepare(`
        UPDATE api_keys SET provider=?, label=?, base_url=?, model=?, extra_config=?, updated_at=CURRENT_TIMESTAMP
        WHERE id=? AND user_id=?
      `).run(provider, label || '', baseUrl || '', model || '', JSON.stringify(extraConfig || {}), req.params.id, req.session.userId);
    }

    res.json({ message: '更新成功' });
  });

  // Delete API key
  router.delete('/:id', requireAuth, (req, res) => {
    const db = getDb();
    const result = db.prepare('DELETE FROM api_keys WHERE id = ? AND user_id = ?').run(req.params.id, req.session.userId);
    if (result.changes === 0) return res.status(404).json({ error: '未找到' });
    res.json({ message: '删除成功' });
  });

  // Get decrypted key (internal use for generation)
  router.get('/:id/decrypt', requireAuth, (req, res) => {
    const db = getDb();
    const key = db.prepare('SELECT * FROM api_keys WHERE id = ? AND user_id = ?').get(req.params.id, req.session.userId);
    if (!key) return res.status(404).json({ error: '未找到' });

    try {
      const decrypted = decrypt(key.api_key_encrypted);
      res.json({
        provider: key.provider,
        apiKey: decrypted,
        baseUrl: key.base_url,
        model: key.model,
        extraConfig: JSON.parse(key.extra_config || '{}'),
      });
    } catch (err) {
      res.status(500).json({ error: '解密失败' });
    }
  });

  return router;
};
