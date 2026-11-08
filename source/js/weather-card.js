/**
 * 侧边栏天气卡片。
 *
 * 和参考站点（tangyuxian.com）的区别
 * ----------------------------------
 * 那边用的是 2345 天气的 iframe 小组件：
 *   https://tianqi.2345.com/plugin/widget/index.htm?...&c=54511&w=300&h=96
 * 优点是一次粘贴就能用、自带 IP 定位和城市切换；
 * 缺点也明显：固定 300×96、配色写死在 URL 参数里（f / ltf / htf）、
 * 深色模式没法适配、整块内容完全依赖对方的服务器。
 *
 * 这个版本自己渲染，同样具备「定位 / 切换 / 空气质量 / 两三天预报」，
 * 但用站点自己的卡片样式和配色，深色模式跟着主题走。
 *
 * 数据源（全部免费、无需 API key、都支持跨域）
 * -------------------------------------------
 *   定位    https://ipwho.is/                     IP 归属地，失败就用手动城市
 *   地理编码 https://geocoding-api.open-meteo.com  城市名 -> 经纬度（做「切换」用）
 *   天气    https://api.open-meteo.com/v1/forecast
 *   空气    https://air-quality-api.open-meteo.com/v1/air-quality
 *
 * 缓存
 * ----
 * 定位结果存 localStorage 永久有效（IP 不会天天变），
 * 天气和空气各缓存 10 分钟 —— 免得每次翻页都打三次请求。
 *
 * 挂载点
 * ------
 * 插在 #aside-content 里 .card-announcement 之后。
 * 侧边栏在窄屏会被主题隐藏，卡片跟着一起消失，不需要额外处理。
 */
(function () {
  'use strict';

  if (window.__vopthWeather) return;      // 防重复初始化（PJAX 会重跑）
  window.__vopthWeather = true;

  var CONFIG = {
    cacheTtl: 10 * 60 * 1000,   // 天气缓存 10 分钟
    // 定位失败后的冷却时间。取 1 小时：
    // 短了会把限流期间的请求打得更狠，长了则用户换网络（比如从移动数据切到宽带）
    // 之后要等太久才能拿到正确位置。
    failTtl: 60 * 60 * 1000,
    days: 3,                    // 预报天数
    timeout: 8000,              // 单次请求超时
    defaultCity: '辽阳',        // IP 定位失败时的兜底
  };

  var LS = {
    loc: 'vopth-weather-loc:v1',
    wx: 'vopth-weather-wx:v1',
    aq: 'vopth-weather-aq:v1',
    manual: 'vopth-weather-manual:v1',
    // IP 定位失败的「负缓存」。
    // ipwho.is 免费额度会限流（实测 429）。原来的逻辑是失败就每次都重试，
    // 结果每打开一次页面就打一次接口、每次都 429，而且兜底永远落到默认城市。
    // 现在记下失败时刻和兜底结果，一小时内直接复用，不再请求。
    fail: 'vopth-weather-locfail:v1',
  };

  // ---- WMO 天气代码 -> 中文 + 图标 ---------------------------------------
  var WMO = {
    0: ['晴', '☀️'], 1: ['大部晴朗', '🌤️'], 2: ['多云', '⛅'], 3: ['阴', '☁️'],
    45: ['雾', '🌫️'], 48: ['雾凇', '🌫️'],
    51: ['小毛毛雨', '🌦️'], 53: ['毛毛雨', '🌦️'], 55: ['大毛毛雨', '🌧️'],
    56: ['冻毛毛雨', '🌧️'], 57: ['强冻毛毛雨', '🌧️'],
    61: ['小雨', '🌦️'], 63: ['中雨', '🌧️'], 65: ['大雨', '🌧️'],
    66: ['冻雨', '🌧️'], 67: ['强冻雨', '🌧️'],
    71: ['小雪', '🌨️'], 73: ['中雪', '🌨️'], 75: ['大雪', '❄️'], 77: ['雪粒', '🌨️'],
    80: ['小阵雨', '🌦️'], 81: ['阵雨', '🌧️'], 82: ['强阵雨', '⛈️'],
    85: ['小阵雪', '🌨️'], 86: ['大阵雪', '❄️'],
    95: ['雷阵雨', '⛈️'], 96: ['雷阵雨伴冰雹', '⛈️'], 99: ['强雷暴伴冰雹', '⛈️'],
  };

  function wxOf(code) {
    return WMO[code] || ['—', '🌡️'];
  }

  // ---- 工具 --------------------------------------------------------------
  function lsGet(key) {
    try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch (e) { return null; }
  }
  function lsSet(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) { /* 隐私模式 */ }
  }

  function fetchJson(url) {
    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, CONFIG.timeout);
    return fetch(url, ctrl ? { signal: ctrl.signal } : undefined)
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (j) { clearTimeout(timer); return j; })
      .catch(function (e) { clearTimeout(timer); throw e; });
  }

  function fmtDate(iso) {
    // iso 形如 2026-11-04
    var d = new Date(iso + 'T00:00:00');
    var names = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
    var today = new Date();
    var same = d.toDateString() === today.toDateString();
    return (same ? '今天' : '明天') + '（' + names[d.getDay()] + '）';
  }

  function dayLabel(iso, idx) {
    var d = new Date(iso + 'T00:00:00');
    var names = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
    if (idx === 0) return '今天（' + names[d.getDay()] + '）';
    if (idx === 1) return '明天（' + names[d.getDay()] + '）';
    return names[d.getDay()];
  }

  function aqInfo(aqi) {
    if (aqi == null) return null;
    if (aqi <= 50)  return { text: '优',     cls: 'aq-good' };
    if (aqi <= 100) return { text: '良',     cls: 'aq-mid' };
    if (aqi <= 150) return { text: '轻度',   cls: 'aq-bad' };
    if (aqi <= 200) return { text: '中度',   cls: 'aq-bad' };
    if (aqi <= 300) return { text: '重度',   cls: 'aq-worse' };
    return { text: '严重', cls: 'aq-worse' };
  }

  // ---- 定位 --------------------------------------------------------------
  function resolveLocation() {
    var manual = lsGet(LS.manual);
    if (manual && manual.lat != null) {
      return Promise.resolve({ city: manual.name, lat: manual.lat, lon: manual.lon, manual: true });
    }

    var cached = lsGet(LS.loc);
    if (cached && cached.lat != null) return Promise.resolve(cached);

    // 负缓存：上次定位失败且还在一小时内，就不再去打 ipwho.is，
    // 直接用上次算好的兜底城市。避免「每次开页面打一次接口、每次都 429」。
    var fail = lsGet(LS.fail);
    if (fail && Date.now() - fail.at < CONFIG.failTtl && fail.lat != null) {
      return Promise.resolve({
        city: fail.city, lat: fail.lat, lon: fail.lon, fallback: true
      });
    }

    return fetchJson('https://ipwho.is/')
      .then(function (j) {
        if (!j || j.success === false || j.latitude == null) throw new Error('ip locate failed');
        var loc = {
          city: j.city || j.region || CONFIG.defaultCity,
          lat: j.latitude,
          lon: j.longitude,
        };
        lsSet(LS.loc, loc);
        // 这次成功了，把之前的失败标记清掉
        try { localStorage.removeItem(LS.fail); } catch (e) {}
        return loc;
      })
      .catch(function () {
        // IP 定位挂了就用地理编码把默认城市查出来
        return geocode(CONFIG.defaultCity).then(function (loc) {
          // 记下失败时刻 + 兜底结果，一小时内不再重复请求
          lsSet(LS.fail, {
            at: Date.now(), city: loc.city, lat: loc.lat, lon: loc.lon
          });
          return loc;
        });
      });
  }

  function geocode(name) {
    var url = 'https://geocoding-api.open-meteo.com/v1/search?count=1&language=zh&format=json&name=' +
              encodeURIComponent(name);
    return fetchJson(url).then(function (j) {
      var r = j && j.results && j.results[0];
      if (!r) throw new Error('找不到城市：' + name);
      return { city: r.name, lat: r.latitude, lon: r.longitude, manual: true };
    });
  }

  // ---- 天气 --------------------------------------------------------------
  function loadWeather(loc) {
    var cached = lsGet(LS.wx);
    if (cached && Date.now() - cached.at < CONFIG.cacheTtl && cached.lat === loc.lat) {
      return Promise.resolve(cached.data);
    }
    var url = 'https://api.open-meteo.com/v1/forecast'
      + '?latitude=' + loc.lat + '&longitude=' + loc.lon
      + '&current=temperature_2m,apparent_temperature,weather_code'
      + '&daily=weather_code,temperature_2m_max,temperature_2m_min'
      + '&timezone=auto&forecast_days=' + CONFIG.days;
    return fetchJson(url).then(function (j) {
      lsSet(LS.wx, { at: Date.now(), lat: loc.lat, data: j });
      return j;
    });
  }

  function loadAir(loc) {
    var cached = lsGet(LS.aq);
    if (cached && Date.now() - cached.at < CONFIG.cacheTtl && cached.lat === loc.lat) {
      return Promise.resolve(cached.data);
    }
    var url = 'https://air-quality-api.open-meteo.com/v1/air-quality'
      + '?latitude=' + loc.lat + '&longitude=' + loc.lon
      + '&current=us_aqi';
    return fetchJson(url).then(function (j) {
      lsSet(LS.aq, { at: Date.now(), lat: loc.lat, data: j });
      return j;
    });
  }

  // ---- 渲染 --------------------------------------------------------------
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function buildCard(loc, wx, aq) {
    var cur = (wx && wx.current) || {};
    var daily = (wx && wx.daily) || {};
    var aqi = aq && aq.current ? aq.current.us_aqi : null;
    var a = aqInfo(aqi);
    var curWx = wxOf(cur.weather_code);

    var daysHtml = '';
    var times = daily.time || [];
    for (var i = 0; i < times.length && i < CONFIG.days; i++) {
      var w = wxOf(daily.weather_code ? daily.weather_code[i] : null);
      var lo = daily.temperature_2m_min ? Math.round(daily.temperature_2m_min[i]) : '—';
      var hi = daily.temperature_2m_max ? Math.round(daily.temperature_2m_max[i]) : '—';
      daysHtml += '<div class="vw-wx-day">'
        + '<div class="vw-wx-day-label">' + esc(dayLabel(times[i], i)) + '</div>'
        + '<div class="vw-wx-day-icon">' + w[1] + '</div>'
        + '<div class="vw-wx-day-temp">' + lo + '~' + hi + '℃</div>'
        + '<div class="vw-wx-day-text">' + esc(w[0]) + '</div>'
        + '</div>';
    }

    var aqHtml = a
      ? '<span class="vw-wx-aq ' + a.cls + '">' + esc(a.text) + '</span>'
      : '<span class="vw-wx-aq">—</span>';

    var card = document.createElement('div');
    card.className = 'card-widget vw-wx-card';
    card.innerHTML =
      '<div class="vw-wx-head">'
      +   '<div class="vw-wx-city">'
      +     '<span class="vw-wx-cityname">' + esc(loc.city) + '</span>'
      +     '<button type="button" class="vw-wx-switch" title="切换城市">切换</button>'
      +   '</div>'
      +   '<div class="vw-wx-aqline">空气质量 ' + aqHtml + '</div>'
      + '</div>'
      + '<div class="vw-wx-now">'
      +   '<span class="vw-wx-now-icon">' + curWx[1] + '</span>'
      +   '<span class="vw-wx-now-temp">' + (cur.temperature_2m != null ? Math.round(cur.temperature_2m) + '℃' : '—') + '</span>'
      +   '<span class="vw-wx-now-text">' + esc(curWx[0]) + '</span>'
      + '</div>'
      + '<div class="vw-wx-days">' + daysHtml + '</div>'
      + '<form class="vw-wx-form" hidden>'
      +   '<input class="vw-wx-input" type="text" placeholder="城市名，如 辽阳 / 北京" autocomplete="off">'
      +   '<button type="submit" class="vw-wx-ok">确定</button>'
      + '</form>';

    // 切换城市
    var form = card.querySelector('.vw-wx-form');
    var input = card.querySelector('.vw-wx-input');
    card.querySelector('.vw-wx-switch').addEventListener('click', function () {
      form.hidden = !form.hidden;
      if (!form.hidden) input.focus();
    });
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var name = (input.value || '').trim();
      if (!name) return;
      input.disabled = true;
      geocode(name).then(function (loc2) {
        lsSet(LS.manual, { name: loc2.city, lat: loc2.lat, lon: loc2.lon });
        // 换了城市，天气缓存作废
        try { localStorage.removeItem(LS.wx); localStorage.removeItem(LS.aq); } catch (e2) {}
        card.replaceWith(buildCard(loc2, null, null));   // 先出骨架
        return refresh(loc2);
      }).catch(function (err) {
        input.disabled = false;
        input.value = '';
        input.placeholder = (err && err.message) || '找不到这个城市';
      });
    });

    return card;
  }

  function mount(card) {
    var aside = document.querySelector('#aside-content');
    if (!aside) return false;
    var old = aside.querySelector('.vw-wx-card');
    if (old) old.remove();
    var anchor = aside.querySelector('.card-announcement') || aside.querySelector('.card-info');
    if (anchor && anchor.nextSibling) {
      aside.insertBefore(card, anchor.nextSibling);
    } else {
      aside.insertBefore(card, aside.firstChild);
    }
    return true;
  }

  function refresh(loc) {
    return Promise.all([
      loadWeather(loc).catch(function () { return null; }),
      loadAir(loc).catch(function () { return null; }),
    ]).then(function (res) {
      var card = buildCard(loc, res[0], res[1]);
      mount(card);
    });
  }

  function boot() {
    // 侧边栏不存在（列表页可能有，文章页也有；窄屏被主题隐藏）就直接跳过
    if (!document.querySelector('#aside-content')) return;

    // 先看看缓存能不能秒出，避免卡片迟到
    var loc0 = lsGet(LS.manual) || lsGet(LS.loc);
    if (loc0 && loc0.lat != null) {
      var wx0 = lsGet(LS.wx);
      var aq0 = lsGet(LS.aq);
      if (wx0 && wx0.data && Date.now() - wx0.at < CONFIG.cacheTtl && wx0.lat === loc0.lat) {
        mount(buildCard(loc0, wx0.data, aq0 && aq0.data));
      }
    }

    resolveLocation()
      .then(refresh)
      .catch(function () { /* 全部失败就不显示卡片，不影响页面 */ });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }

  // PJAX 换页后侧边栏会被替换，重新挂一次
  document.addEventListener('pjax:complete', function () {
    setTimeout(boot, 50);
  });
})();
