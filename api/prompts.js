import { Redis } from '@upstash/redis';

const redis = Redis.fromEnv();

export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Endpoint untuk komentar spesifik prompt
  if (req.method === 'POST' && req.url.includes('/comments')) {
    try {
      const promptId = req.url.split('/')[2];
      const comment = req.body;
      
      if (!comment || !comment.text || !comment.rating) {
        return res.status(400).json({ error: 'Data komentar tidak valid' });
      }
      
      // Ambil prompt dari Redis
      const prompts = await redis.lrange('prompts', 0, -1);
      const parsedPrompts = prompts.map(p => JSON.parse(p));
      const promptIndex = parsedPrompts.findIndex(p => p.id === promptId);
      
      if (promptIndex === -1) {
        return res.status(404).json({ error: 'Prompt tidak ditemukan' });
      }
      
      // Tambah komentar
      if (!parsedPrompts[promptIndex].comments) {
        parsedPrompts[promptIndex].comments = [];
      }
      
      parsedPrompts[promptIndex].comments.unshift(comment);
      
      // Update rating rata-rata
      const comments = parsedPrompts[promptIndex].comments;
      const totalRating = comments.reduce((sum, c) => sum + c.rating, 0);
      parsedPrompts[promptIndex].rating = (totalRating / comments.length).toFixed(1);
      parsedPrompts[promptIndex].ratingCount = comments.length;
      
      // Simpan kembali ke Redis
      await redis.del('prompts');
      for (const prompt of parsedPrompts) {
        await redis.lpush('prompts', JSON.stringify(prompt));
      }
      await redis.ltrim('prompts', 0, 999);
      
      return res.status(201).json({ success: true });
      
    } catch (error) {
      return res.status(500).json({ error: 'Gagal menyimpan komentar' });
    }
  }

  if (req.method === 'GET') {
    try {
      const prompts = await redis.lrange('prompts', 0, -1);
      const parsedPrompts = prompts.map(p => JSON.parse(p));
      
      // Sort by timestamp (newest first)
      parsedPrompts.sort((a, b) => b.timestamp - a.timestamp);
      
      res.status(200).json(parsedPrompts);
    } catch (error) {
      res.status(500).json({ error: 'Gagal mengambil data' });
    }
  }

  if (req.method === 'POST') {
    try {
      const promptData = req.body;
      
      // Validasi
      const validation = validatePrompt(promptData);
      if (!validation.isValid) {
        return res.status(400).json({ errors: validation.errors });
      }

      // Generate ID dan timestamp
      const finalPrompt = {
        id: `prompt-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        nama: sanitizeText(promptData.nama),
        ai: promptData.ai.filter(Boolean).slice(0, 10),
        description: sanitizeText(promptData.description),
        prompt: promptData.prompt, // Sudah di-handle di frontend (encrypted atau plain)
        creator: promptData.creator || 'Anonymous',
        isAnonymous: promptData.isAnonymous || false,
        priceType: promptData.priceType || 'free',
        price: promptData.price || 0,
        rating: 0,
        ratingCount: 0,
        comments: [],
        timestamp: Date.now(),
        status: 'approved'
      };

      // Jika prompt berbayar, simpan encryptedPrompt jika ada
      if (promptData.priceType === 'paid' && promptData.encryptedPrompt) {
        finalPrompt.encryptedPrompt = promptData.encryptedPrompt;
        finalPrompt.prompt = '[ENCRYPTED]'; // Placeholder untuk UI
        finalPrompt.sellerContact = promptData.sellerContact || '';
      }

      // Simpan ke Redis
      await redis.lpush('prompts', JSON.stringify(finalPrompt));
      await redis.ltrim('prompts', 0, 999);

      // Return tanpa password (password hanya di frontend)
      const responsePrompt = { ...finalPrompt };
      delete responsePrompt.encryptedPassword; // Pastikan password tidak dikirim back

      res.status(201).json({ 
        success: true, 
        prompt: responsePrompt,
        message: promptData.priceType === 'paid' ? 
          'Prompt berhasil diupload dengan sistem enkripsi otomatis' : 
          'Prompt berhasil diupload'
      });
    } catch (error) {
      console.error('Error saving prompt:', error);
      res.status(500).json({ error: 'Gagal menyimpan prompt' });
    }
  }
}

// Validator
function validatePrompt(data) {
  const result = { isValid: true, errors: [] };

  if (!data.nama || data.nama.trim().length < 3) {
    result.errors.push('Nama prompt minimal 3 karakter');
  }
  if (data.nama.length > 100) {
    result.errors.push('Nama prompt maksimal 100 karakter');
  }

  if (!data.prompt || data.prompt.trim().length < 10) {
    result.errors.push('Isi prompt minimal 10 karakter');
  }
  if (data.prompt.length > 100000) {
    result.errors.push('Isi prompt terlalu panjang (maksimal 100k karakter)');
  }

  if (!data.ai || !Array.isArray(data.ai) || data.ai.length === 0) {
    result.errors.push('Pilih minimal 1 AI yang didukung');
  }

  if (data.ai && data.ai.length > 10) {
    result.errors.push('Maksimal 10 AI yang didukung');
  }

  if (data.priceType === 'paid') {
    if (data.price < 1000 || data.price > 1000000) {
      result.errors.push('Harga harus antara Rp 1.000 - Rp 1.000.000');
    }
    
    if (data.sellerContact && data.sellerContact.length > 200) {
      result.errors.push('Kontak penjual terlalu panjang (maksimal 200 karakter)');
    }
  }

  // Deteksi virus text / virtex
  if (containsVirtex(data.prompt)) {
    result.errors.push('Terdeteksi karakter tidak valid dalam prompt');
  }

  // Deteksi spam/repetisi
  if (isSpammy(data.prompt)) {
    result.errors.push('Prompt mengandung terlalu banyak repetisi');
  }

  // Deteksi binary/unicode aneh
  if (containsSuspiciousUnicode(data.prompt)) {
    result.errors.push('Terdeteksi karakter unicode mencurigakan');
  }

  result.isValid = result.errors.length === 0;
  return result;
}

function containsVirtex(text) {
  if (!text) return false;
  
  // Zero-width characters
  const zeroWidthRegex = /[\u200B-\u200F\uFEFF\u202A-\u202E]/g;
  if (zeroWidthRegex.test(text)) return true;

  // Combining characters berlebihan
  const combiningRegex = /[\u0300-\u036F]/g;
  const combiningMatches = text.match(combiningRegex);
  if (combiningMatches && combiningMatches.length > text.length * 0.3) return true;

  // RTL characters berlebihan
  const rtlRegex = /[\u0591-\u07FF\u200F\u202B\u202E\uFB1D-\uFDFD\uFE70-\uFEFC]/g;
  const rtlMatches = text.match(rtlRegex);
  if (rtlMatches && rtlMatches.length > text.length * 0.4) return true;

  return false;
}

function isSpammy(text) {
  if (!text) return false;
  
  // Karakter berulang berlebihan (contoh: "aaaaaa")
  const charRepetition = /(.)\1{10,}/g;
  if (charRepetition.test(text)) return true;

  // Kata berulang berlebihan
  const words = text.toLowerCase().split(/\s+/);
  const wordCount = {};
  words.forEach(word => {
    if (word.length > 3) {
      wordCount[word] = (wordCount[word] || 0) + 1;
    }
  });

  for (let word in wordCount) {
    if (wordCount[word] > 20) return true;
  }

  return false;
}

function containsSuspiciousUnicode(text) {
  if (!text) return false;
  
  // Unicode private use areas
  const privateUseRegex = /[\uE000-\uF8FF]/g;
  if (privateUseRegex.test(text)) return true;

  // Control characters (selain whitespace normal)
  const controlCharsRegex = /[\u0000-\u001F\u007F-\u009F]/g;
  if (controlCharsRegex.test(text)) return true;

  return false;
}

function sanitizeText(text) {
  if (!text) return '';
  
  // Hapus zero-width characters
  text = text.replace(/[\u200B-\u200F\uFEFF\u202A-\u202E]/g, '');
  
  // Hapus control characters
  text = text.replace(/[\u0000-\u001F\u007F-\u009F]/g, '');
  
  // Normalize whitespace
  text = text.replace(/\s+/g, ' ').trim();
  
  return text;
}
