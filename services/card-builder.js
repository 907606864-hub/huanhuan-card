/**
 * Card Builder Service
 * Builds SillyTavern-compatible character card PNG files
 * Embeds character JSON data in PNG tEXt chunk (key: "chara")
 * Reference: /opt/nova-creator-cli/build-card.js
 */

const { PNG } = require('pngjs');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const config = require('../config');

/**
 * Create a chara_card_v3 JSON structure
 */
function buildCharacterJSON({
  name,
  description = '',
  personality = '',
  scenario = '',
  firstMes = '',
  mesExample = '',
  creatorNotes = '',
  systemPrompt = '',
  postHistoryInstructions = '',
  creator = '欢欢卡站',
  characterVersion = '1.0',
  tags = [],
  characterBook = null,
  alternateGreetings = [],
  /* MVU assembler output (optional) */
  regexScripts = [],
  tavernHelperScripts = [],
  /* Extra extensions to merge (huanhuan meta, imported extensions, etc.) */
  extensions: extraExtensions = {},
}) {
  const now = new Date();
  const createDate = `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()} @${now.getHours()}h ${now.getMinutes()}m ${now.getSeconds()}s`;

  // Add CC BY-NC 4.0 to creator_notes
  const fullCreatorNotes = creatorNotes
    ? `${creatorNotes}\n\n---\n${config.CC_LICENSE}`
    : config.CC_LICENSE;

  const extensions = {
    talkativeness: '0.5',
    fav: false,
    world: name,
    depth_prompt: { prompt: '', depth: 4, role: 'system' },
    regex_scripts: regexScripts,
    ...extraExtensions,
  };

  /* Only add TavernHelper_scripts when we actually have them */
  if (tavernHelperScripts.length > 0) {
    extensions.TavernHelper_scripts = tavernHelperScripts;
  }

  const card = {
    name,
    description,
    personality,
    scenario,
    first_mes: firstMes,
    mes_example: mesExample,
    creatorcomment: fullCreatorNotes,
    avatar: 'none',
    talkativeness: '0.5',
    fav: false,
    tags,
    spec: 'chara_card_v3',
    spec_version: '3.0',
    data: {
      name,
      description,
      personality,
      scenario,
      first_mes: firstMes,
      mes_example: mesExample,
      creator_notes: fullCreatorNotes,
      system_prompt: systemPrompt,
      post_history_instructions: postHistoryInstructions,
      tags,
      creator,
      character_version: characterVersion,
      alternate_greetings: alternateGreetings,
      extensions,
      group_only_greetings: [],
      character_book: characterBook || { entries: [], name },
    },
    create_date: createDate,
  };

  return card;
}

/**
 * Create a tEXt chunk for PNG
 * PNG tEXt chunk format: keyword + null separator + text
 */
function createTextChunk(keyword, text) {
  const keyBuf = Buffer.from(keyword, 'latin1');
  const nullByte = Buffer.from([0]);
  const textBuf = Buffer.from(text, 'latin1');
  
  const data = Buffer.concat([keyBuf, nullByte, textBuf]);
  
  // Chunk: length(4) + type(4) + data + crc(4)
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  
  const type = Buffer.from('tEXt', 'ascii');
  
  // CRC over type + data
  const crcData = Buffer.concat([type, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(crcData) >>> 0);
  
  return Buffer.concat([length, type, data, crc]);
}

/**
 * CRC32 computation for PNG chunks
 */
function crc32(buf) {
  let table = crc32.table;
  if (!table) {
    table = crc32.table = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let j = 0; j < 8; j++) {
        c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      }
      table[i] = c;
    }
  }
  
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    crc = table[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

/**
 * Embed character JSON into a PNG image as a tEXt chunk
 * @param {Buffer} imageBuffer - PNG image buffer
 * @param {Object} characterData - Character card JSON
 * @returns {Buffer} PNG with embedded character data
 */
function embedCharacterInPNG(imageBuffer, characterData) {
  const jsonStr = JSON.stringify(characterData);
  const base64 = Buffer.from(jsonStr, 'utf8').toString('base64');
  
  // Create the tEXt chunk
  const textChunk = createTextChunk('chara', base64);
  
  // Find IEND position in the PNG
  const iendSignature = Buffer.from('IEND', 'ascii');
  let iendPos = -1;
  
  for (let i = imageBuffer.length - 12; i >= 0; i--) {
    if (imageBuffer.subarray(i + 4, i + 8).equals(iendSignature)) {
      iendPos = i;
      break;
    }
  }
  
  if (iendPos === -1) {
    throw new Error('Invalid PNG: IEND chunk not found');
  }
  
  // Insert tEXt chunk before IEND
  const before = imageBuffer.subarray(0, iendPos);
  const iend = imageBuffer.subarray(iendPos);
  
  return Buffer.concat([before, textChunk, iend]);
}

/**
 * Create a default cover image (solid color with gradient)
 * Returns a PNG buffer
 */
function createDefaultCover(width = 400, height = 600) {
  const png = new PNG({ width, height });
  
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (width * y + x) << 2;
      // Deep purple to dark blue gradient
      const t = y / height;
      png.data[idx]     = Math.floor(40 + 30 * (1 - t));   // R
      png.data[idx + 1] = Math.floor(20 + 20 * t);          // G
      png.data[idx + 2] = Math.floor(80 + 100 * t);         // B
      png.data[idx + 3] = 255;                               // A
    }
  }
  
  return PNG.sync.write(png);
}

/**
 * Build a complete character card PNG
 * @param {Object} params
 * @param {Object} params.characterData - Character data fields
 * @param {Buffer|null} params.coverImage - Cover image PNG buffer (optional)
 * @param {string} params.outputPath - Where to save the card
 * @returns {string} Path to the generated card file
 */
function buildCard({ characterData, coverImage, outputPath }) {
  // Build the character JSON
  const cardJSON = buildCharacterJSON(characterData);
  
  // Use provided cover or generate default
  let imageBuffer = coverImage;
  if (!imageBuffer) {
    imageBuffer = createDefaultCover();
  }
  
  // Embed character data into PNG
  const finalPNG = embedCharacterInPNG(imageBuffer, cardJSON);
  
  // Ensure output directory exists
  const dir = path.dirname(outputPath);
  fs.mkdirSync(dir, { recursive: true });
  
  // Write the file
  fs.writeFileSync(outputPath, finalPNG);
  
  return outputPath;
}

/**
 * Extract character JSON from a PNG file's tEXt chunk (key: "chara")
 * @param {Buffer} pngBuffer - PNG file buffer
 * @returns {Object|null} Parsed character card JSON, or null if not found
 */
function parseCharacterFromPNG(pngBuffer) {
  const pngSig = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
  if (!pngBuffer.subarray(0, 8).equals(pngSig)) {
    throw new Error('不是有效的 PNG 文件');
  }

  let offset = 8;
  while (offset < pngBuffer.length) {
    if (offset + 8 > pngBuffer.length) break;
    const length = pngBuffer.readUInt32BE(offset);
    const chunkType = pngBuffer.subarray(offset + 4, offset + 8).toString('ascii');

    if (chunkType === 'tEXt') {
      const dataStart = offset + 8;
      const dataEnd = dataStart + length;
      if (dataEnd > pngBuffer.length) break;
      const data = pngBuffer.subarray(dataStart, dataEnd);

      /* keyword\0text */
      const nullIdx = data.indexOf(0);
      if (nullIdx !== -1) {
        const keyword = data.subarray(0, nullIdx).toString('ascii');
        if (keyword === 'chara') {
          const base64Text = data.subarray(nullIdx + 1).toString('ascii');
          const jsonStr = Buffer.from(base64Text, 'base64').toString('utf8');
          return JSON.parse(jsonStr);
        }
      }
    }

    /* next chunk: length(4) + type(4) + data(length) + crc(4) */
    offset += 12 + length;
  }

  return null;
}

module.exports = { buildCard, buildCharacterJSON, embedCharacterInPNG, createDefaultCover, parseCharacterFromPNG };
