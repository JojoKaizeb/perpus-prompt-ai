
const { Redis } = require('@upstash/redis');

exports.handler = async (event) => {
  const redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN,
  });
  
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  };
  
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }
  
  if (event.httpMethod === 'GET') {
    try {
      const prompts = await redis.lrange('prompts', 0, -1);
      const parsed = prompts.map(p => JSON.parse(p)).sort((a, b) => b.timestamp - a.timestamp);
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify(parsed)
      };
    } catch (error) {
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: error.message })
      };
    }
  }
  
  if (event.httpMethod === 'POST') {
    try {
      const data = JSON.parse(event.body);
      const prompt = {
        id: `prompt-${Date.now()}`,
        nama: data.nama,
        ai: data.ai || [],
        description: data.description || '',
        prompt: data.prompt,
        creator: data.creator || 'Anonymous',
        priceType: data.priceType || 'free',
        price: data.price || 0,
        rating: 0,
        ratingCount: 0,
        timestamp: Date.now(),
        status: 'approved'
      };
      
      if (data.priceType === 'paid' && data.encryptedPrompt) {
        prompt.encryptedPrompt = data.encryptedPrompt;
        prompt.sellerContact = data.sellerContact || '';
        prompt.prompt = '[ENCRYPTED]';
      }
      
      await redis.lpush('prompts', JSON.stringify(prompt));
      await redis.ltrim('prompts', 0, 999);
      
      return {
        statusCode: 201,
        headers,
        body: JSON.stringify({ success: true, prompt })
      };
    } catch (error) {
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: error.message })
      };
    }
  }
  
  return {
    statusCode: 405,
    headers,
    body: JSON.stringify({ error: 'Method not allowed' })
  
