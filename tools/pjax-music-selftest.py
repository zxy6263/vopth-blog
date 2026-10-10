"""用 Edge 的 CDP 接口自动化测试本地站点（PJAX + 悬浮播放器）。

覆盖面（29 项）
===============
    1. 首页：播放器 DOM 是否存在、是否挂在 body 直属下、是否懒加载
    2. 点击：面板展开、iframe 指向网易官方外链、localStorage 记住选择
    3. PJAX 翻页：★ 播放器是不是【同一个 DOM 元素】、iframe 有没有被重载
    4. 其他脚本：profile-hero / reading-progress / banner-video 有没有重跑
    5. 栏目页：banner 视频、右下角后台入口

为什么要这么测
==============
这次改动的核心风险是【PJAX】—— 它会把 #body-wrap 整个换掉。
肉眼看不出"某个脚本没重跑"，只会表现为"某个效果没了"。所以必须让浏览器
自己回答：元素在不在、是不是同一个元素、URL 变了没有。

关键判据
========
「播放器有没有被 PJAX 换掉」不能只看"元素存在" —— 换掉之后新页面可能又建一个。
正确判据是【引用相等】：翻页前把元素存进 window.__ref，翻页后比较
document.getElementById('vopth-music') === window.__ref。
同一个对象 = 没被替换 = iframe 没重载 = 音乐不断。

用法
====
    # 1) 起本地静态服务器
    #    ⚠️ 仓库路径含空格（deepseek harnass），Start-Process 传【数组】时
    #       不会给含空的元素补引号，必须传单个字符串并自己加引号
    Start-Process python -ArgumentList '-m http.server 4000 --bind 127.0.0.1 --directory "D:\\deepseek harnass\\vopth-blog\\public"'

    # 2) 跑测试
    python tools\\pjax-music-selftest.py

依赖
====
    · Edge（路径写死在下面 EDGE 常量里）
    · Python 包 websockets：pip install websockets
      （本机用的解释器是 D:\\esp32\\venv\\Scripts\\python.exe —— 那是为
        ESP32 建的环境，里面正好带 websockets）

只读：不改任何仓库文件，只启一个临时 Edge 实例读页面状态。
"""

from __future__ import annotations

import asyncio
import json
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

import websockets

EDGE = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
SITE = "http://127.0.0.1:4000"


def free_port() -> int:
    """要一个空闲端口。

    ⚠️ 不能写死 9222。踩过的坑：
       Edge 被 terminate() 之后【子进程还活着】，仍占着 9222。
       下一次跑的时候 urllib 连上去，连到的是【上一次那个旧浏览器】——
       它的页面还停在空白，于是所有断言一次性全挂（12/38），
       看起来像"页面整个坏了"，其实只是连错了浏览器。
    """
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return int(s.getsockname()[1])


def kill_tree(pid: int) -> None:
    """先按 PID 杀进程树（快速路径）。"""
    try:
        subprocess.run(
            ["taskkill", "/F", "/T", "/PID", str(pid)],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            timeout=15,
        )
    except Exception:
        pass


def kill_by_profile(marker: str) -> int:
    """把所有命令行里带这个标记的 msedge 进程杀掉，返回杀掉的个数。

    ⚠️ 为什么光靠 taskkill /T 不够：
       Edge 的子进程会被【重新挂到别的父进程】下（browser broker 机制），
       所以 /T 只能收到一部分 —— 实测每跑一轮还残留 20 个 msedge。
       下一轮这些进程虽然端口不同不会再连错，但它们白占内存，
       跑几轮就能堆到上百个。

    标记用【本次随机的配置目录名】（edge-cdp-xxxxxx），
    所以只会命中我们自己起的实例，不会误伤用户正在用的 Edge。
    """
    ps = (
        "Get-CimInstance Win32_Process -Filter \"Name='msedge.exe'\" -ErrorAction SilentlyContinue"
        f" | Where-Object {{ $_.CommandLine -like '*{marker}*' }}"
        " | ForEach-Object { try { Stop-Process -Id $_.ProcessId -Force -ErrorAction Stop } catch {} }"
    )
    try:
        subprocess.run(
            ["powershell", "-NoProfile", "-NonInteractive", "-Command", ps],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            timeout=40,
        )
    except Exception:
        pass

    # 数一下还剩几个
    try:
        out = subprocess.run(
            [
                "powershell", "-NoProfile", "-NonInteractive", "-Command",
                "(Get-CimInstance Win32_Process -Filter \"Name='msedge.exe'\" "
                f"-ErrorAction SilentlyContinue | Where-Object {{ $_.CommandLine -like '*{marker}*' }}).Count",
            ],
            capture_output=True, text=True, timeout=30,
        )
        return int((out.stdout or "0").strip() or 0)
    except Exception:
        return -1

results: list[tuple[bool, str, str]] = []


def check(ok: bool, name: str, detail: str = "") -> None:
    results.append((bool(ok), name, detail))
    print(f"  [{'PASS' if ok else 'FAIL'}] {name}" + (f"   {detail}" if detail else ""))


class CDP:
    def __init__(self, ws) -> None:
        self.ws = ws
        self._id = 0
        # 页面里未捕获的异常都收在这儿。
        # ⚠️ 为什么必须收：那个"打开就关不掉"的 bug 在界面上【毫无反应】，
        #    唯一的现象就是控制台一条 TypeError。只看 DOM 状态是发现不了的。
        self.exceptions: list[str] = []

    async def send(self, method: str, params: dict | None = None, session: str | None = None):
        self._id += 1
        mid = self._id
        msg: dict = {"id": mid, "method": method, "params": params or {}}
        if session:
            msg["sessionId"] = session
        await self.ws.send(json.dumps(msg))
        while True:
            raw = await self.ws.recv()
            data = json.loads(raw)
            if data.get("method") == "Runtime.exceptionThrown":
                d = data.get("params", {}).get("exceptionDetails", {})
                text = (
                    d.get("exception", {}).get("description")
                    or d.get("text")
                    or "?"
                )
                self.exceptions.append(str(text).splitlines()[0])
            if data.get("id") == mid:
                return data

    async def ev(self, session: str, expr: str):
        r = await self.send(
            "Runtime.evaluate",
            {"expression": expr, "returnByValue": True, "awaitPromise": True},
            session,
        )
        res = r.get("result", {})
        if "exceptionDetails" in res:
            return {"__error": str(res["exceptionDetails"])}
        return res.get("result", {}).get("value")


async def wait_url(cdp: CDP, session: str, needle: str, timeout: float = 12.0) -> bool:
    t0 = time.time()
    while time.time() - t0 < timeout:
        u = await cdp.ev(session, "location.pathname")
        if isinstance(u, str) and needle in u:
            return True
        await asyncio.sleep(0.25)
    return False


async def wait_ready(cdp: CDP, session: str, timeout: float = 20.0) -> bool:
    """等页面真正就绪：pjax 库已加载 + 播放器已挂载。

    ⚠️ 为什么必须有这个，不能只 sleep(N)：
       第一版用固定 sleep(3.0) 就往下断言，赶上环境繁忙时 pjax.min.js 还没执行完，
       于是点链接走的是【普通整页跳转】而不是 PJAX，一次性刷出一串 FAIL
       （"没有整页刷新""播放器是同一个元素"全挂），还带一条
       ReferenceError: Pjax is not defined。
       手动复刻同样的操作序列却完全正常 —— 说明那是【测试的竞态】，不是页面 bug。
       判据要等状态，不能等时间。
    """
    t0 = time.time()
    while time.time() - t0 < timeout:
        ok = await cdp.ev(
            session,
            "typeof window.Pjax === 'function'"
            " && !!document.getElementById('vopth-music')",
        )
        if ok:
            return True
        await asyncio.sleep(0.25)
    return False


async def main() -> int:
    profile = Path(tempfile.mkdtemp(prefix="edge-cdp-"))
    cdp_port = free_port()
    print(f"  （调试端口 {cdp_port}，浏览器配置目录 {profile.name}）")
    proc = subprocess.Popen(
        [
            EDGE,
            "--headless=new",
            f"--remote-debugging-port={cdp_port}",
            f"--user-data-dir={profile}",
            "--no-first-run",
            "--no-default-browser-check",
            "--disable-gpu",
            "--window-size=1400,900",
            "about:blank",
        ],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )

    try:
        # 等 CDP 就绪
        ws_url = None
        for _ in range(40):
            try:
                with urllib.request.urlopen(
                    f"http://127.0.0.1:{cdp_port}/json/version", timeout=1
                ) as fh:
                    ws_url = json.load(fh)["webSocketDebuggerUrl"]
                break
            except Exception:
                time.sleep(0.4)
        if not ws_url:
            print("  [!] CDP 起不来")
            return 1

        async with websockets.connect(ws_url, max_size=40 * 1024 * 1024) as ws:
            cdp = CDP(ws)

            t = await cdp.send("Target.createTarget", {"url": "about:blank"})
            target_id = t["result"]["targetId"]
            a = await cdp.send(
                "Target.attachToTarget", {"targetId": target_id, "flatten": True}
            )
            session = a["result"]["sessionId"]

            await cdp.send("Page.enable", {}, session)
            await cdp.send("Runtime.enable", {}, session)

            # ============================================================
            print()
            print("=" * 66)
            print("  1) 首页加载")
            print("=" * 66)
            await cdp.send("Page.navigate", {"url": SITE + "/"}, session)
            ready = await wait_ready(cdp, session)
            check(ready, "页面就绪（Pjax 库已加载 + 播放器已挂载）")

            check(
                await cdp.ev(session, "!!document.getElementById('vopth-music')"),
                "播放器 DOM 存在",
            )
            check(
                await cdp.ev(session, "!!document.querySelector('.vopth-music-toggle')"),
                "悬浮按钮存在",
            )
            state = await cdp.ev(
                session, "document.getElementById('vopth-music').dataset.state"
            )
            check(state == "closed", "初始是收起状态", f"data-state={state}")
            check(
                await cdp.ev(
                    session,
                    "document.querySelectorAll('.vopth-music-frame').length === 0",
                ),
                "初始没有创建 iframe（懒加载）",
            )

            # 播放器是不是挂在 body 直属下（不是 #body-wrap 里）
            check(
                await cdp.ev(
                    session,
                    "document.getElementById('vopth-music').parentElement === document.body",
                ),
                "播放器挂在 body 直属下（PJAX 碰不到）",
            )
            check(
                await cdp.ev(session, "!!document.querySelector('.ph-card')"),
                "首页简介卡片存在（profile-hero 正常）",
            )

            # ============================================================
            print()
            print("=" * 66)
            print("  2) 点击悬浮按钮 → 展开并创建 iframe")
            print("=" * 66)
            await cdp.ev(session, "document.querySelector('.vopth-music-toggle').click()")
            await asyncio.sleep(1.5)

            # iframe 是异步创建的（要先 fetch /music/playlist.json 才知道放哪首）
            for _ in range(48):
                if await cdp.ev(session, "!!document.querySelector('.vopth-music-frame')"):
                    break
                await asyncio.sleep(0.25)

            state = await cdp.ev(
                session, "document.getElementById('vopth-music').dataset.state"
            )
            check(state == "open", "点开后是展开状态", f"data-state={state}")
            frame_src = await cdp.ev(
                session,
                "(document.querySelector('.vopth-music-frame')||{}).src || ''",
            )
            check(bool(frame_src), "iframe 已创建")
            check(
                "music.163.com/outchain/player" in str(frame_src),
                "iframe 指向网易官方外链",
                str(frame_src)[:100],
            )
            check(
                "type=2" in str(frame_src),
                "用的是单曲模式（type=2，随机播放的前提）",
            )
            check(
                await cdp.ev(
                    session,
                    "/[?&]id=\\d{5,}/.test((document.querySelector('.vopth-music-frame')||{}).src||'')",
                ),
                "id 是具体的歌曲 ID（不是歌单 ID）",
            )
            check(
                await cdp.ev(
                    session,
                    "(document.querySelector('.vopth-music-frame')||{}).getAttribute"
                    " && document.querySelector('.vopth-music-frame').getAttribute('allow')"
                    " .indexOf('autoplay') >= 0",
                ),
                "iframe 带 allow=autoplay",
            )
            # 歌单数据必须真的拿到了 336 个 ID，否则随机没意义
            n_ids = await cdp.ev(
                session,
                "fetch('/music/playlist.json').then(r=>r.json())"
                ".then(j=>(j.trackIds||[]).length).catch(()=>-1)",
            )
            check(
                isinstance(n_ids, int) and n_ids > 1,
                "歌单数据可读且多首（随机池够大）",
                f"trackIds={n_ids}",
            )
            localStorage_on = await cdp.ev(
                session, "localStorage.getItem('vopth:music:on')"
            )
            check(localStorage_on == "1", "记住了访客选择", f"localStorage={localStorage_on}")

            # ============================================================
            print()
            print("=" * 66)
            print("  2a) 换一首：每次都要换到不同的歌")
            print("=" * 66)
            first_src = str(frame_src)
            changed = False
            for attempt in range(6):
                await cdp.ev(session, "document.querySelectorAll('.vopth-music-iconbtn')[0].click()")
                for _ in range(24):
                    await asyncio.sleep(0.25)
                    now_src = await cdp.ev(
                        session,
                        "(document.querySelector('.vopth-music-frame')||{}).src || ''",
                    )
                    if now_src and now_src != first_src:
                        changed = True
                        break
                if changed:
                    break
            check(changed, "★ 点「换一首」能换到别的歌", f"尝试 {attempt + 1} 次")
            check(
                "type=2" in str(
                    await cdp.ev(
                        session,
                        "(document.querySelector('.vopth-music-frame')||{}).src || ''",
                    )
                ),
                "换歌后仍是单曲模式",
            )

            # ============================================================
            print()
            print("=" * 66)
            print("  2b) 关闭路径（三条都要能关）")
            print("=" * 66)
            # ⚠️ 这一节是补的。
            #    第一版漏测了关闭，于是上线了一个「打开就关不掉」的 bug：
            #    关闭按钮的变量名和关闭函数都叫 close，var 把 function 覆盖掉，
            #    每次点击抛 TypeError —— 界面毫无反应，控制台只有一条错。
            #    所以关闭的三条路径必须逐条验证。

            async def state() -> str:
                return str(
                    await cdp.ev(
                        session, "document.getElementById('vopth-music').dataset.state"
                    )
                )

            # 路径 1：再点一次悬浮按钮
            await cdp.ev(session, "document.querySelector('.vopth-music-toggle').click()")
            await asyncio.sleep(0.8)
            s = await state()
            check(s == "closed", "① 再点悬浮按钮能关掉", f"data-state={s}")
            check(
                await cdp.ev(
                    session,
                    "getComputedStyle(document.querySelector('.vopth-music-panel')).visibility"
                    " === 'hidden'",
                ),
                "① 关掉后面板确实不可见",
            )

            # 路径 2：关闭按钮 ×
            await cdp.ev(session, "document.querySelector('.vopth-music-toggle').click()")
            await asyncio.sleep(0.8)
            s = await state()
            check(s == "open", "② 重新打开成功", f"data-state={s}")
            await cdp.ev(session, "document.querySelector('.vopth-music-close').click()")
            await asyncio.sleep(0.8)
            s = await state()
            check(s == "closed", "② 点 × 能关掉", f"data-state={s}")

            # 路径 3：Esc
            await cdp.ev(session, "document.querySelector('.vopth-music-toggle').click()")
            await asyncio.sleep(0.8)
            await cdp.ev(
                session,
                "document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}));true",
            )
            await asyncio.sleep(0.8)
            s = await state()
            check(s == "closed", "③ Esc 能关掉", f"data-state={s}")

            # 关闭后 iframe 不该被销毁（网易继续播，这也正是"关掉界面但音乐不断"）
            check(
                await cdp.ev(session, "!!document.querySelector('.vopth-music-frame')"),
                "关掉后 iframe 仍在（音乐不会被切断）",
            )

            # 页面上不能有未捕获的 JS 错误 —— 上面那个 bug 就是靠这个露馅的
            check(
                not cdp.exceptions,
                "没有未捕获的 JS 异常",
                "; ".join(cdp.exceptions[:3])[:120],
            )

            # 收尾：重新打开，好继续后面的 PJAX 测试
            await cdp.ev(session, "document.querySelector('.vopth-music-toggle').click()")
            await asyncio.sleep(1.2)
            s = await state()
            check(s == "open", "④ 再次打开正常（准备做 PJAX 测试）", f"data-state={s}")

            # ============================================================
            print()
            print("=" * 66)
            print("  3) PJAX 翻页：播放器必须【是同一个元素】")
            print("=" * 66)
            await cdp.ev(
                session,
                "window.__ref = document.getElementById('vopth-music');"
                "window.__frame = document.querySelector('.vopth-music-frame');"
                "window.__navmark = 'alive';"
                "true",
            )

            # 找一个文章链接点进去
            href = await cdp.ev(
                session,
                "(function(){var a=document.querySelector('#recent-posts a[href*=\"/20\"]');"
                "return a ? a.getAttribute('href') : null;})()",
            )
            print(f"    目标链接: {href}")
            await cdp.ev(
                session,
                "var a=document.querySelector('#recent-posts a[href*=\"/20\"]'); if(a) a.click(); true",
            )
            await wait_url(cdp, session, "/20")

            path = await cdp.ev(session, "location.pathname")
            check(
                isinstance(path, str) and "/20" in path,
                "URL 已经变到文章页（PJAX 生效）",
                f"path={path}",
            )
            check(
                await cdp.ev(session, "window.__navmark === 'alive'"),
                "★ 没有整页刷新（window 变量还在）",
            )
            check(
                await cdp.ev(
                    session,
                    "document.getElementById('vopth-music') === window.__ref",
                ),
                "★ 播放器是同一个 DOM 元素（没被 PJAX 换掉）",
            )
            check(
                await cdp.ev(
                    session,
                    "document.querySelector('.vopth-music-frame') === window.__frame",
                ),
                "★ iframe 是同一个对象（音乐不会重载）",
            )
            state = await cdp.ev(
                session, "document.getElementById('vopth-music').dataset.state"
            )
            check(state == "open", "翻页后仍然展开着", f"data-state={state}")

            # ============================================================
            print()
            print("=" * 66)
            print("  4) 其他脚本在 PJAX 后有没有重跑")
            print("=" * 66)
            check(
                await cdp.ev(session, "!!document.querySelector('.reading-progress')"),
                "文章页出现阅读进度条",
            )
            check(
                await cdp.ev(session, "!document.querySelector('.ph-card')"),
                "文章页没有首页简介卡片",
            )
            check(
                await cdp.ev(
                    session,
                    "document.querySelector('.reading-progress')"
                    " && document.querySelector('.reading-progress').parentElement === document.body",
                ),
                "进度条挂在 body 直属下",
            )

            # 回首页（PJAX）→ 卡片要回来、进度条要撤掉
            await cdp.ev(session, "var a=document.querySelector('a[href=\"/\"]'); if(a) a.click(); true")
            # 首页的 pathname 是 "/"，用 wait_url 判断不了（任何路径都含 "/"），单独等
            for _ in range(48):
                if (await cdp.ev(session, "location.pathname")) in ("/", ""):
                    break
                await asyncio.sleep(0.25)
            path2 = await cdp.ev(session, "location.pathname")
            check(path2 in ("/", ""), "已回到首页", f"path={path2}")
            check(
                await cdp.ev(session, "!!document.querySelector('.ph-card')"),
                "★ 回首页后简介卡片重新出现（profile-hero 重跑了）",
            )
            check(
                await cdp.ev(session, "!document.querySelector('.reading-progress')"),
                "★ 回首页后进度条被撤掉（reading-progress 重跑了）",
            )
            check(
                await cdp.ev(
                    session,
                    "document.getElementById('vopth-music') === window.__ref",
                ),
                "★ 绕了两页播放器依然是同一个元素",
            )

            # ============================================================
            print()
            print("=" * 66)
            print("  5) 栏目页：banner 视频 + 后台入口")
            print("=" * 66)
            await cdp.send("Page.navigate", {"url": SITE + "/about/"}, session)
            await wait_ready(cdp, session)
            check(
                await cdp.ev(session, "!!document.querySelector('.banner-video')"),
                "关于页 banner 视频已插入",
            )
            check(
                await cdp.ev(session, "!!document.getElementById('admin-entry')"),
                "右下角后台入口存在",
            )
            check(
                await cdp.ev(
                    session,
                    "!!(window.btf && typeof window.btf.addEventListenerPjax === 'function')",
                ),
                "主题 btf 工具可用",
            )

            # 从 /about/ PJAX 到 /archives/，视频应该重新插入
            await cdp.ev(session, "var a=document.querySelector('a[href=\"/archives/\"]'); if(a) a.click(); true")
            await wait_url(cdp, session, "/archives")
            check(
                await cdp.ev(session, "location.pathname.indexOf('/archives') === 0"),
                "PJAX 到归档页",
                await cdp.ev(session, "location.pathname"),
            )
            check(
                await cdp.ev(session, "!!document.querySelector('.banner-video')"),
                "★ 归档页也有 banner 视频（banner-video 重跑了）",
            )

            # 控制台错误
            print()
            errs = await cdp.ev(
                session,
                "JSON.stringify(window.__cdpErrors || [])",
            )
            print(f"    （未捕获错误收集: {errs}）")

    finally:
        # ⚠️ 必须杀【整棵进程树 + 按配置目录兜底】。
        #    proc.terminate() 只结束父进程，msedge 会派生几十个子进程留在后台，
        #    而且它们仍然占着调试端口。实测跑一轮后残留了 23 个 msedge 进程，
        #    下一轮 urllib 就可能会连到这些旧实例上（页面停在空白），
        #    表现成"整站全挂"，其实只是连错了浏览器。
        kill_tree(proc.pid)
        left = kill_by_profile(profile.name)
        if left > 0:
            print(f"  [!] 仍有 {left} 个 msedge 没清掉（配置目录 {profile.name}）")
        try:
            proc.wait(timeout=8)
        except Exception:
            pass
        shutil.rmtree(profile, ignore_errors=True)

    print()
    print("=" * 66)
    passed = sum(1 for ok, _, _ in results if ok)
    total = len(results)
    print(f"  结果：{passed}/{total} 通过")
    print("=" * 66)
    for ok, name, detail in results:
        if not ok:
            print(f"  ❌ {name}   {detail}")
    return 0 if passed == total else 2


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
