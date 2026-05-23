const Redis = require('ioredis');

let redis = null;

if (process.env.REDIS_URL) {
  redis = new Redis(process.env.REDIS_URL, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
  });
  redis.on('error', (err) => {
    console.error('[Redis] 연결 오류:', err.message);
  });
}

module.exports = { redis };
