/**
 * 最小的 SMTP 发信实现（给 Cloudflare Workers 用）
 * ===========================================================================
 *
 * 为什么不用现成的库
 *   Workers 里没有 Node 的 net/tls，普通邮件库跑不起来。但 Workers 提供了
 *   cloudflare:sockets，可以自己连 TCP —— 实测能连上 smtp.qq.com:465，
 *   服务器回应：
 *     220 newxmesmtplogicsvrszc43-0.qq.com XMail Esmtp QQ Mail Server.
 *     250-AUTH LOGIN PLAIN XOAUTH XOAUTH2
 *   所以这里手写一个刚好够用的 SMTP 客户端：EHLO -> AUTH LOGIN ->
 *   MAIL FROM -> RCPT TO -> DATA -> QUIT。
 *
 * 凭据从哪来
 *   调用方传进来，值来自 Worker 的【运行时密钥】：
 *     env.SMTP_USER / env.SMTP_PASS
 *   绝不硬编码、绝不进仓库（这个仓库是公开的）。
 *
 * 支持的邮件格式
 *   纯文本 + UTF-8。主题用 RFC 2047 编码，否则中文主题会变乱码。
 *   正文按 8BITMIME（服务器支持 SMTPUTF8/8BITMIME，见上面的 EHLO 应答）。
 *
 * 出错时的行为
 *   每一行服务器应答都会检查状态码，>=400 直接抛错（带服务器原话），
 *   这样调用方能知道到底是认证失败还是收件人被拒。
 */

import { connect } from 'cloudflare:sockets';

const CRLF = '\r\n';
const TE = new TextEncoder();

/** UTF-8 安全的 base64（btoa 只吃 latin1，直接塞中文会炸） */
function base64Utf8(str) {
  const bytes = TE.encode(str);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

/** 主题里有非 ASCII 时做 RFC 2047 编码 */
function encodeHeader(str) {
  if (/^[\x20-\x7e]*$/.test(str)) return str;
  return '=?UTF-8?B?' + base64Utf8(str) + '?=';
}

/** 正文按 SMTP 规矩转义：行首的 "." 要写成 ".."，换行统一成 CRLF */
function dotStuff(text) {
  return String(text)
    .replace(/\r\n|\r|\n/g, CRLF)
    .replace(/^\./gm, '..');
}

/**
 * 发一封邮件。
 * @returns {Promise<{ok: boolean, steps: string[]}>} steps 是 SMTP 对话记录，方便排错
 */
export async function sendMail(opts) {
  const {
    host = 'smtp.qq.com',
    port = 465,
    user,
    pass,
    from,
    to,
    subject,
    text
  } = opts;

  if (!user || !pass) throw new Error('缺少 SMTP 凭据（SMTP_USER / SMTP_PASS 未设置）');
  if (!from || !to) throw new Error('缺少 from / to');
  if (from.indexOf('@') < 0 || to.indexOf('@') < 0) throw new Error('from / to 不是合法邮箱地址');

  const steps = [];
  const socket = connect({ hostname: host, port: port }, { secureTransport: 'on' });

  const reader = socket.readable.getReader();
  const writer = socket.writable.getWriter();
  const decoder = new TextDecoder();
  let buffer = '';

  // 读一行（不含 CRLF）
  async function readLine() {
    for (;;) {
      const idx = buffer.indexOf(CRLF);
      if (idx !== -1) {
        const line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + CRLF.length);
        return line;
      }
      const { value, done } = await reader.read();
      if (done) throw new Error('SMTP 连接提前关闭。已收到的：' + buffer.slice(-200));
      buffer += decoder.decode(value, { stream: true });
    }
  }

  // 读一个完整应答（SMTP 多行应答：前几行第 4 位是 "-"，最后一行是 " "）
  async function readReply() {
    const lines = [];
    for (;;) {
      const line = await readLine();
      lines.push(line);
      if (line.length < 4) break;
      if (line.charAt(3) !== '-') break;
    }
    return lines;
  }

  // 发一条命令并检查应答
  async function cmd(command, expectPrefixes) {
    if (command !== null) {
      await writer.write(TE.encode(command + CRLF));
    }
    const lines = await readReply();
    const last = lines[lines.length - 1];
    const code = parseInt(last.slice(0, 3), 10);
    const ok = expectPrefixes.some((p) => String(code).startsWith(String(p)));
    steps.push((command === null ? '(greeting)' : command.replace(/^AUTH LOGIN.*/, 'AUTH LOGIN ***')) +
      '  <-  ' + last.slice(0, 120));
    if (!ok) {
      throw new Error('SMTP 第 ' + code + ' 步失败：' + last.slice(0, 200));
    }
    return lines;
  }

  try {
    // 1. 服务器问候
    await cmd(null, [2]);

    // 2. EHLO
    await cmd('EHLO ' + (opts.helo || 'vopth.xyz'), [2]);

    // 3. AUTH LOGIN（用户名、密码分别 base64）
    await cmd('AUTH LOGIN', [3]);
    await cmd(base64Utf8(user), [3]);
    await cmd(base64Utf8(pass), [2]);

    // 4. 信封 + 正文
    await cmd('MAIL FROM:<' + from + '>', [2]);
    await cmd('RCPT TO:<' + to + '>', [2, 25]);   // 251 = 会转发
    await cmd('DATA', [3]);

    const headers = [
      'From: ' + from,
      'To: ' + to,
      'Subject: ' + encodeHeader(subject || '(无主题)'),
      'Date: ' + new Date().toUTCString(),
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=UTF-8',
      'Content-Transfer-Encoding: 8bit',
      'X-Mailer: vopth.xyz notifier'
    ].join(CRLF);

    const payload = headers + CRLF + CRLF + dotStuff(text || '') + CRLF + '.';
    await cmd(payload, [2]);

    // 5. 礼貌收尾
    try { await cmd('QUIT', [2]); } catch (e) { /* 收尾失败无所谓 */ }

    return { ok: true, steps: steps };
  } finally {
    try { await reader.releaseLock(); } catch (e) {}
    try { await writer.releaseLock(); } catch (e) {}
    try { await socket.close(); } catch (e) {}
  }
}
