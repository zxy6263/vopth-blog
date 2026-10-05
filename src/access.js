/**
 * Cloudflare Access 鉴权
 * ===========================================================================
 *
 * 为什么不用「检查某个请求头存不存在」这种简单做法
 *   Cloudflare Access 会在放行时注入 Cf-Access-Jwt-Assertion（一个 JWT）和
 *   Cf-Access-Authenticated-User-Email。只判断「这个头有没有」是**不安全**的：
 *   只要有人能直接访问 Worker（比如 xxx.workers.dev 那个地址，它和自定义域名
 *   是两个 hostname，Access 策略是按 hostname 配的，不一定覆盖到），他就能自己
 *   伪造这两个头。
 *
 *   所以这里做**真正的签名校验**：拿 Access 团队域名的公钥（JWKS）验证 JWT 的
 *   RS256 签名，再检查 iss / aud / exp。签名对不上就是没通过 Access。
 *
 * 需要两个变量（wrangler.jsonc 的 vars，或在控制台配）：
 *   ACCESS_TEAM_DOMAIN  形如 myteam.cloudflareaccess.com（不带 https://）
 *   ACCESS_AUD          Access 应用的 Audience 标签（AUD），在 Access 应用详情页能拿到
 *
 * 失败一律「关闭」（fail closed）：没配好、取不到公钥、校验不过，全部拒绝。
 */

const encoder = new TextEncoder();

/** base64url -> Uint8Array（JWT 的三段都是 base64url，不能用普通的 atob 直接解） */
function b64urlToBytes(s) {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + pad;
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function decodeJson(bytes) {
  return JSON.parse(new TextDecoder().decode(bytes));
}

/**
 * @returns {Promise<{ok:boolean, reason?:string, email?:string}>}
 */
export async function verifyAccess(request, env) {
  const teamDomain = env.ACCESS_TEAM_DOMAIN;
  // ⚠️ Cloudflare Access 里【每个应用有自己的 AUD】。
  //    这个站点需要保护两个路径（/admin 和 /api/admin），
  //    所以要么是两个应用、要么是一个应用挂两个目标 —— 前者会产生两个 AUD。
  //    这里按逗号/空格/换行拆成列表，任意一个匹配即通过。
  const audList = String(env.ACCESS_AUD || '')
    .split(/[\s,]+/)
    .filter(Boolean);

  if (!teamDomain || audList.length === 0) {
    // 没配好就别放人进来。宁可后台打不开，也不能让没鉴权的请求改仓库。
    return { ok: false, reason: 'access_not_configured' };
  }

  const jwt = request.headers.get('cf-access-jwt-assertion');
  if (!jwt) return { ok: false, reason: 'missing_jwt' };

  const parts = jwt.split('.');
  if (parts.length !== 3) return { ok: false, reason: 'malformed_jwt' };
  const [rawHeader, rawPayload, rawSig] = parts;

  let header, payload;
  try {
    header = decodeJson(b64urlToBytes(rawHeader));
    payload = decodeJson(b64urlToBytes(rawPayload));
  } catch (e) {
    return { ok: false, reason: 'undecodable_jwt' };
  }

  if (header.alg !== 'RS256') return { ok: false, reason: 'unexpected_alg' };

  // ---- 声明校验 -------------------------------------------------------
  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp === 'number' && payload.exp < now) {
    return { ok: false, reason: 'expired' };
  }
  if (payload.iss !== `https://${teamDomain}`) {
    return { ok: false, reason: 'bad_issuer' };
  }
  const tokenAud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!tokenAud.some((a) => audList.includes(a))) {
    return { ok: false, reason: 'bad_audience' };
  }

  // ---- 取公钥并验签 ---------------------------------------------------
  let jwks;
  try {
    const res = await fetch(`https://${teamDomain}/cdn-cgi/access/certs`, {
      // 公钥很少变，但也不能缓存太久，免得轮换后验不过
      cf: { cacheTtl: 300, cacheEverything: true }
    });
    if (!res.ok) return { ok: false, reason: 'certs_http_' + res.status };
    jwks = await res.json();
  } catch (e) {
    return { ok: false, reason: 'certs_fetch_failed' };
  }

  const keys = (jwks && jwks.keys) || [];
  // 先按 kid 精确匹配；找不到就退化成用所有 RSA 公钥逐个试
  // （Access 轮换密钥时，令牌里的 kid 有时对不上最新的 JWKS）
  const candidates = keys.filter((k) => k.kty === 'RSA');
  const byKid = candidates.filter((k) => k.kid && k.kid === header.kid);
  const tryKeys = byKid.length ? byKid : candidates;
  if (!tryKeys.length) return { ok: false, reason: 'no_usable_key' };

  const signedData = encoder.encode(rawHeader + '.' + rawPayload);
  const signature = b64urlToBytes(rawSig);

  for (const jwk of tryKeys) {
    try {
      const key = await crypto.subtle.importKey(
        'jwk',
        { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
        { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
        false,
        ['verify']
      );
      const valid = await crypto.subtle.verify(
        'RSASSA-PKCS1-v1_5',
        key,
        signature,
        signedData
      );
      if (valid) {
        return { ok: true, email: payload.email || payload.sub || '' };
      }
    } catch (e) {
      // 这把钥匙用不了就试下一把
    }
  }

  return { ok: false, reason: 'bad_signature' };
}
