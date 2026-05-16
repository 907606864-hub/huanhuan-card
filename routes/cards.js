const { getDb } = require('../db/init');
const { buildCard, buildCharacterJSON } = require('../services/card-builder');
const { createEntryBase } = require('../services/mvu-assembler');
const { injectHuanhuanMeta } = require('../services/card-helpers');
const fs = require('fs');
const path = require('path');
const config = require('../config');

module.exports = function (router) {

  function requireAuth(req, res, next) {
    if (!req.session.userId) return res.status(401).json({ error: '未登录' });
    next();
  }

  /* ============================================================
   * PUBLIC routes (no auth, CORS: *)
   * These MUST be registered BEFORE requireAuth routes.
   * ============================================================ */

  /* Version check */
  router.get('/public/:id/version', (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    const db = getDb();
    const card = db.prepare('SELECT name, version, updated_at FROM cards WHERE id = ?').get(req.params.id);
    if (!card) return res.status(404).json({ error: '未找到' });
    res.json({ version: card.version || 1, name: card.name, updatedAt: card.updated_at });
  });

  /* Public download */
  router.get('/public/:id/download', (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    const db = getDb();
    const card = db.prepare('SELECT * FROM cards WHERE id = ?').get(req.params.id);
    if (!card) return res.status(404).json({ error: '未找到' });

    const filePath = card.card_file_path;
    if (!filePath || !fs.existsSync(filePath)) {
      return res.status(404).json({ error: '卡片文件不存在' });
    }

    const fmt = card.format || (filePath.endsWith('.json') ? 'json' : 'png');
    const filename = encodeURIComponent(`${card.name}.${fmt}`);
    const contentType = fmt === 'json' ? 'application/json' : 'image/png';

    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${filename}`);
    res.setHeader('Content-Type', contentType);
    fs.createReadStream(filePath).pipe(res);
  });

  /* CORS preflight for public routes */
  router.options('/public/:id/version', (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.sendStatus(204);
  });
  router.options('/public/:id/download', (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.sendStatus(204);
  });

  /* ============================================================
   * AUTH-required routes
   * ============================================================ */

  /* Import external character card PNG → save to DB → return card info */
  router.post('/import', requireAuth, async (req, res) => {
    try {
      const { imageBase64 } = req.body;
      if (!imageBase64) return res.status(400).json({ error: '请上传角色卡文件' });

      const { parseCharacterFromPNG } = require('../services/card-builder');
      const buf = Buffer.from(imageBase64, 'base64');
      const cardData = parseCharacterFromPNG(buf);
      if (!cardData) {
        return res.status(400).json({ error: '未在图片中找到角色卡数据（需要 chara tEXt chunk 的 PNG）' });
      }

      const d = cardData.data || cardData;
      const cardId = require('crypto').randomUUID();
      const cardName = d.name || '未命名';

      /* Build characterData from imported card */
      const characterData = {
        name: cardName,
        description: d.description || '',
        personality: d.personality || '',
        scenario: d.scenario || '',
        firstMes: d.first_mes || '',
        mesExample: d.mes_example || '',
        creatorNotes: d.creator_notes || '',
        systemPrompt: d.system_prompt || '',
        post_history_instructions: d.post_history_instructions || '',
        creator: d.creator || req.session.discordUser?.global_name || '',
        tags: d.tags || [],
        regexScripts: [],
        tavernHelperScripts: [],
        characterBook: { entries: [], name: cardName },
      };

      /* Preserve regex_scripts from original card */
      if (d.extensions && d.extensions.regex_scripts) {
        characterData.regexScripts = d.extensions.regex_scripts;
      }

      /* Preserve TavernHelper scripts from original card */
      if (d.extensions && d.extensions.TavernHelper_scripts) {
        characterData.tavernHelperScripts = d.extensions.TavernHelper_scripts;
      }

      /* Preserve character_book entries with full metadata */
      if (d.character_book && d.character_book.entries && d.character_book.entries.length) {
        characterData.characterBook.entries = d.character_book.entries;
        characterData.characterBook.name = d.character_book.name || cardName;
      }

      /* Preserve any extra extensions */
      if (d.extensions) {
        characterData._importedExtensions = { ...d.extensions };
        delete characterData._importedExtensions.regex_scripts;
        delete characterData._importedExtensions.TavernHelper_scripts;
      }

      /* Inject huanhuan meta + auto-update script */
      injectHuanhuanMeta(characterData, cardId, 1);

      /* Build output file (always PNG since we have cover) */
      const outputPath = path.join(config.CARDS_DIR, `${cardId}.png`);

      let coverImage;
      try {
        const sharp = require('sharp');
        coverImage = await sharp(buf).png().toBuffer();
      } catch (_) {
        coverImage = buf;
      }

      buildCard({ characterData, coverImage, outputPath });

      /* Save to database */
      const db = getDb();
      db.prepare(`
        INSERT INTO cards (id, user_id, name, description, character_data, card_file_path, format, version, status)
        VALUES (?, ?, ?, ?, ?, ?, 'png', 1, 'completed')
      `).run(cardId, req.session.userId, cardName, (characterData.description || '').substring(0, 200), JSON.stringify(characterData), outputPath);

      res.json({
        id: cardId,
        name: cardName,
        version: 1,
        format: 'png',
        message: `角色卡「${cardName}」导入成功`,
      });
    } catch (err) {
      console.error('Card import error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  /* List user's cards */
  router.get('/', requireAuth, (req, res) => {
    const db = getDb();
    const cards = db.prepare(`
      SELECT id, name, description, format, status, version, created_at, updated_at 
      FROM cards WHERE user_id = ? ORDER BY created_at DESC
    `).all(req.session.userId);
    res.json(cards);
  });

  /* Get card detail */
  router.get('/:id', requireAuth, (req, res) => {
    const db = getDb();
    const card = db.prepare('SELECT * FROM cards WHERE id = ? AND user_id = ?')
      .get(req.params.id, req.session.userId);
    if (!card) return res.status(404).json({ error: '未找到' });
    res.json(card);
  });

  /* Update card (PUT) */
  router.put('/:id', requireAuth, async (req, res) => {
    try {
      const db = getDb();
      const card = db.prepare('SELECT * FROM cards WHERE id = ? AND user_id = ?')
        .get(req.params.id, req.session.userId);
      if (!card) return res.status(404).json({ error: '未找到' });

      const { name, description, character_data, cover_image_base64, entries } = req.body;

      /* Parse character_data */
      let characterData;
      try {
        characterData = typeof character_data === 'string' ? JSON.parse(character_data) : (character_data || {});
      } catch (e) {
        return res.status(400).json({ error: 'character_data JSON 解析失败' });
      }

      /* If entries were provided, replace characterBook.entries */
      if (entries && Array.isArray(entries)) {
        if (!characterData.characterBook) {
          characterData.characterBook = { entries: [], name: name || card.name };
        }
        characterData.characterBook.entries = entries.map((entry, idx) => {
          const e = createEntryBase();
          e.id = idx;
          e.comment = entry.comment || entry.name || `条目 ${idx + 1}`;
          e.content = entry.content || '';
          e.enabled = entry.enabled !== false;
          e.keys = entry.keys || entry.keywords || [];
          e.secondary_keys = entry.secondary_keys || [];
          e.constant = !!entry.constant;
          e.selective = entry.selective !== undefined ? entry.selective : !entry.constant;
          e.position = entry.position || 'before_char';
          e.insertion_order = entry.insertion_order !== undefined ? entry.insertion_order : idx;
          e.extensions.position = entry.extensions_position !== undefined ? entry.extensions_position : 0;
          e.extensions.display_index = idx;
          e.extensions.depth = entry.depth !== undefined ? entry.depth : 4;
          e.extensions.role = entry.role !== undefined ? entry.role : 0;
          return e;
        });
      }

      /* Version bump */
      const newVersion = (card.version || 1) + 1;

      /* Inject huanhuan meta + auto-update script */
      injectHuanhuanMeta(characterData, card.id, newVersion);

      /* Determine output format */
      let hasCover = !!cover_image_base64;
      /* If no new cover uploaded, check if existing card has a PNG cover */
      if (!hasCover && card.card_file_path && card.format === 'png' && fs.existsSync(card.card_file_path)) {
        hasCover = true;
      }

      const ext = hasCover ? 'png' : 'json';
      const outputPath = path.join(config.CARDS_DIR, `${card.id}.${ext}`);

      if (hasCover) {
        let coverImage;
        if (cover_image_base64) {
          coverImage = Buffer.from(cover_image_base64, 'base64');
          /* Ensure PNG format */
          const pngSig = Buffer.from([0x89, 0x50, 0x4E, 0x47]);
          if (!coverImage.subarray(0, 4).equals(pngSig)) {
            try {
              const sharp = require('sharp');
              coverImage = await sharp(coverImage).png().toBuffer();
            } catch (sharpErr) {
              const { PNG } = require('pngjs');
              const decoded = PNG.sync.read(coverImage);
              coverImage = PNG.sync.write(decoded);
            }
          }
        } else {
          /* Use existing card file — extract the image portion by re-reading the PNG */
          /* For simplicity, use sharp to strip metadata and get clean PNG */
          try {
            const sharp = require('sharp');
            coverImage = await sharp(card.card_file_path).png().toBuffer();
          } catch (e) {
            coverImage = fs.readFileSync(card.card_file_path);
          }
        }
        buildCard({ characterData, coverImage, outputPath });
      } else {
        const cardJSON = buildCharacterJSON(characterData);
        fs.mkdirSync(path.dirname(outputPath), { recursive: true });
        fs.writeFileSync(outputPath, JSON.stringify(cardJSON, null, 2), 'utf-8');
      }

      /* Update database */
      const cardName = name || card.name;
      const cardDesc = description !== undefined ? description : card.description;
      db.prepare(`
        UPDATE cards 
        SET name = ?, description = ?, character_data = ?, card_file_path = ?, 
            format = ?, version = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(
        cardName,
        (cardDesc || '').substring(0, 200),
        JSON.stringify(characterData),
        outputPath,
        ext,
        newVersion,
        card.id
      );

      res.json({
        id: card.id,
        name: cardName,
        version: newVersion,
        format: ext,
        message: `保存成功（v${newVersion}）`,
      });
    } catch (err) {
      console.error('Card update error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  /* Download card (PNG or JSON) */
  router.get('/:id/download', requireAuth, (req, res) => {
    const db = getDb();
    const card = db.prepare('SELECT * FROM cards WHERE id = ? AND user_id = ?')
      .get(req.params.id, req.session.userId);
    if (!card) return res.status(404).json({ error: '未找到' });

    const filePath = card.card_file_path;
    if (!filePath || !fs.existsSync(filePath)) {
      return res.status(404).json({ error: '卡片文件不存在' });
    }

    const fmt = card.format || (filePath.endsWith('.json') ? 'json' : 'png');
    const filename = encodeURIComponent(`${card.name}.${fmt}`);
    const contentType = fmt === 'json' ? 'application/json' : 'image/png';

    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${filename}`);
    res.setHeader('Content-Type', contentType);
    fs.createReadStream(filePath).pipe(res);
  });

  /* Delete card */
  router.delete('/:id', requireAuth, (req, res) => {
    const db = getDb();
    const card = db.prepare('SELECT * FROM cards WHERE id = ? AND user_id = ?')
      .get(req.params.id, req.session.userId);
    if (!card) return res.status(404).json({ error: '未找到' });

    /* Delete file */
    if (card.card_file_path && fs.existsSync(card.card_file_path)) {
      fs.unlinkSync(card.card_file_path);
    }

    db.prepare('DELETE FROM cards WHERE id = ?').run(req.params.id);
    res.json({ message: '删除成功' });
  });

  return router;
};
