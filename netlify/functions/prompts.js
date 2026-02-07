const { Redis } = require('@upstash/redis');

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

exports.handler = async (event, context) => {
  // CORS headers
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Content-Type': 'application/json',
  };

  // Handle preflight requests
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers,
      body: '',
    };
  }

  try {
    // GET - Ambil semua prompts
    if (event.httpMethod === 'GET') {
      const prompts = await redis.lrange('prompts', 0, -1);
      const parsedPrompts = prompts.map(p => JSON.parse(p))
        .sort((a, b) => b.timestamp - a.timestamp);

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify(parsedPrompts),
      };
    }

    // POST - Tambah prompt baru
    if (event.httpMethod === 'POST') {
      const data = JSON.parse(event.body);
      
      const newPrompt = {
        id: `prompt-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        nama: data.nama?.trim() || '',
        ai: Array.isArray(data.ai) ? data.ai : [],
        description: data.description?.trim() || '',
        prompt: data.prompt?.trim() || '',
        encryptedPrompt: data.encryptedPrompt || null,
        creator: data.creator?.trim() || 'Anonymous',
        isAnonymous: data.isAnonymous || false,
        priceType: data.priceType || 'free',
        price: data.priceType === 'paid' ? parseInt(data.price) || 0 : 0,
        sellerContact: data.sellerContact?.trim() || '',
        rating: 0,
        ratingCount: 0,
        comments: [],
        timestamp: Date.now(),
        status: 'approved',
      };

      // Validasi data
      if (!newPrompt.nama) {
        throw new Error('Nama prompt diperlukan');
      }
      if (newPrompt.ai.length === 0) {
        throw new Error('Pilih minimal 1 AI yang didukung');
      }
      if (!newPrompt.description) {
        throw new Error('Deskripsi diperlukan');
      }
      if (!newPrompt.prompt && !newPrompt.encryptedPrompt) {
        throw new Error('Konten prompt diperlukan');
      }
      if (newPrompt.priceType === 'paid' && newPrompt.price < 1000) {
        throw new Error('Harga minimal Rp 1.000 untuk prompt berbayar');
      }
      if (newPrompt.priceType === 'paid' && !newPrompt.sellerContact) {
        throw new Error('Kontak penjual diperlukan untuk prompt berbayar');
      }

      await redis.lpush('prompts', JSON.stringify(newPrompt));
      await redis.ltrim('prompts', 0, 999); // Batasi maksimal 1000 prompts

      return {
        statusCode: 201,
        headers,
        body: JSON.stringify({ 
          success: true, 
          prompt: newPrompt,
          message: 'Prompt berhasil ditambahkan'
        }),
      };
    }

    // Method not allowed
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' }),
    };

  } catch (error) {
    console.error('Error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        error: error.message || 'Internal server error',
        details: error.stack
      }),
    };
  }
};
