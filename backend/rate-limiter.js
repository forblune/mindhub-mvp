// 인메모리 고정 윈도우 rate limiter. now()를 주입 가능하게 해 실제 sleep 없이 윈도우 만료를 테스트할 수 있다.
function makeRateLimiter({ windowMs, max, now = Date.now }){
  const buckets = new Map();
  return (req, res, next) => {
    const current = now();
    const key = req.ip || (req.socket && req.socket.remoteAddress) || "unknown";
    let bucket = buckets.get(key);
    if(!bucket || current >= bucket.resetAt){
      bucket = { count:0, resetAt: current + windowMs };
      buckets.set(key, bucket);
    }
    bucket.count += 1;
    res.set("RateLimit-Limit", String(max));
    res.set("RateLimit-Remaining", String(Math.max(0, max - bucket.count)));
    res.set("RateLimit-Reset", String(Math.ceil(bucket.resetAt / 1000)));
    if(bucket.count > max){
      res.set("Retry-After", String(Math.ceil((bucket.resetAt - current) / 1000)));
      return res.status(429).json({ error:"too_many_requests", message:"요청이 많아요. 잠시 후 다시 시도해 주세요." });
    }
    if(buckets.size > 1000){
      for(const [ip, value] of buckets){
        if(current >= value.resetAt) buckets.delete(ip);
      }
    }
    next();
  };
}

module.exports = { makeRateLimiter };
