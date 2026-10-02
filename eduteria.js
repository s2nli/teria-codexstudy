/* Eduteria Learning Platform for Codexyt
   Flow: Batches -> Subjects -> Topics/Lectures -> Video player (hash routed, back button works) */
(function () {
  "use strict";
  const API = "https://open-mora-natking151-ea9216fb.koyeb.app";
  const TIMEOUT_MS = 20000;
  const HLS_SRC = "https://cdnjs.cloudflare.com/ajax/libs/hls.js/1.5.13/hls.min.js";
  const SHAKA_SRC = "https://cdnjs.cloudflare.com/ajax/libs/shaka-player/4.7.11/shaka-player.compiled.js";

  const $ = (s, r = document) => r.querySelector(s);
  const esc = (v = "") => String(v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[c]));
  const toast = (m) => (typeof showToast === "function" ? showToast(m) : null);

  const state = { batches: null, batchQuery: "", subjects: {}, contents: {}, player: null };
  let root, view, crumbs, navToken = 0;

  /* ---------- API ---------- */
  async function api(path) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(API + path, { cache: "no-store", headers: { Accept: "application/json" }, signal: ctrl.signal });
      const text = await res.text();
      let data = null;
      try { data = JSON.parse(text); } catch (e) {}
      if (!res.ok) throw new Error((data && (data.error || data.message)) || `Server error (${res.status})`);
      if (data == null) throw new Error("Unexpected response from server");
      return data;
    } catch (e) {
      if (e.name === "AbortError") throw new Error("The server is taking too long to respond.");
      if (e instanceof TypeError) throw new Error("Could not reach the server. Check your connection.");
      throw e;
    } finally { clearTimeout(timer); }
  }
  const list = (d, key) => (Array.isArray(d) ? d : d && Array.isArray(d[key]) ? d[key] : d && Array.isArray(d.data) ? d.data : []);
  const getBatches = async () => list(await api("/eduteria/batches"), "batches");
  const getSubjects = async (b) => list(await api(`/eduteria/batches/${encodeURIComponent(b)}/subjects`), "subjects");
  const getContents = async (b, s) => list(await api(`/eduteria/batches/${encodeURIComponent(b)}/subjects/${encodeURIComponent(s)}/contents`), "contents");
  const getVideo = (vid) => api(`/eduteria/video-details?vid=${encodeURIComponent(vid)}`);

  /* ---------- UI helpers ---------- */
  const IMG_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg>';
  const ARROW = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14M13 6l6 6-6 6"/></svg>';
  const PLAY = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';

  function thumb(src, cls = "") {
    if (!src) return `<div class="edu-thumb-ph">${IMG_ICON}</div>`;
    return `<img class="${cls}" src="${esc(src)}" alt="" loading="lazy" referrerpolicy="no-referrer" onload="this.classList.add('loaded')" onerror="this.outerHTML='<div class=&quot;edu-thumb-ph&quot;>'+window.__eduImg+'</div>'">`;
  }
  window.__eduImg = IMG_ICON;

  function skeleton(kind, n = 8) {
    if (kind === "video") return '<div class="edu-skel-video"><div class="skeleton-thumb" style="height:100%"></div></div><div class="skeleton-body"><div class="skeleton-line" style="width:70%"></div><div class="skeleton-line" style="width:40%"></div></div>';
    if (kind === "rows") return `<div class="edu-rows">${Array.from({ length: n }, () => '<div class="skeleton-card" style="height:70px"><div class="skeleton-thumb" style="height:100%"></div></div>').join("")}</div>`;
    return `<div class="course-grid">${Array.from({ length: n }, () => '<div class="skeleton-card"><div class="skeleton-thumb"></div><div class="skeleton-body"><div class="skeleton-line" style="width:88%"></div><div class="skeleton-line" style="width:60%"></div><div class="skeleton-line" style="width:40%"></div></div></div>').join("")}</div>`;
  }

  function errorBox(msg, retryId) {
    return `<div class="edu-error" role="alert"><div class="edu-error-ico">!</div><h3>Something went wrong</h3><p>${esc(msg)}</p><button class="btn btn-primary" type="button" id="${retryId}">Try again</button></div>`;
  }

  function setCrumbs(items) {
    crumbs.innerHTML = items.map((it, i) => it.href && i < items.length - 1
      ? `<a href="${it.href}">${esc(it.label)}</a>` : `<span>${esc(it.label)}</span>`).join('<i>/</i>');
  }

  /* ---------- Views ---------- */
  function batchTitle(b) { return b.title || b.name || "Untitled batch"; }
  function batchId(b) { return b.id != null ? b.id : b._id; }

  /* Batches are listed on the Home page (app.js grid); this maps them into that grid. */
  function toHomeBatch(b) {
    return { _id: String(batchId(b)), name: batchTitle(b), previewImage: b.thumbnail || b.banner || b.image || "", byName: b.category || "Eduteria", _edu: true };
  }

  async function loadHomeBatches(force) {
    if (!window.CXHome) return;
    try {
      if (force || !state.batches) state.batches = await getBatches();
      window.CXHome.setRemoteBatches(state.batches.map(toHomeBatch));
    } catch (err) {
      window.CXHome.setRemoteBatches([], (err && err.message) || "Could not load batches.");
    }
  }

  function findBatch(id) { return (state.batches || []).find((b) => String(batchId(b)) === String(id)); }

  async function showSubjects(bid, token) {
    const known = findBatch(bid);
    const base = [{ label: "Home", href: "#home" }];
    setCrumbs([...base, { label: known ? batchTitle(known) : `Batch ${bid}` }]);
    if (!state.subjects[bid]) {
      view.innerHTML = skeleton("rows", 6);
      try { state.subjects[bid] = await getSubjects(bid); }
      catch (e) {
        if (token !== navToken) return;
        view.innerHTML = errorBox(e.message, "eduRetry");
        $("#eduRetry").onclick = () => route();
        return;
      }
    }
    if (token !== navToken) return;
    const subs = state.subjects[bid];
    $("#eduCount").textContent = `${subs.length} subject${subs.length === 1 ? "" : "s"}`;
    if (!subs.length) { view.innerHTML = '<div class="empty">No subjects found in this batch yet.</div>'; return; }
    view.innerHTML = `<div class="edu-head"><h2>${esc(known ? batchTitle(known) : "Subjects")}</h2><p>Choose a subject to see its lectures.</p></div>
      <div class="edu-subjects">${subs.map((s) => `
      <button class="edu-subject" type="button" data-id="${esc(s.id)}">
        <span class="edu-subject-ico">${s.icon && /^https?:/.test(s.icon) ? `<img src="${esc(s.icon)}" alt="" referrerpolicy="no-referrer" onerror="this.remove()">` : esc((s.name || "?").trim().charAt(0).toUpperCase())}</span>
        <span class="edu-subject-name">${esc(s.name || s.title || "Subject")}</span>${ARROW}
      </button>`).join("")}</div>`;
    view.querySelectorAll(".edu-subject").forEach((btn) => btn.addEventListener("click", () => {
      location.hash = `#eduteria/b/${encodeURIComponent(bid)}/s/${encodeURIComponent(btn.dataset.id)}`;
    }));
  }

  async function showContents(bid, sid, token) {
    const b = findBatch(bid);
    const sub = (state.subjects[bid] || []).find((s) => String(s.id) === String(sid));
    setCrumbs([{ label: "Home", href: "#home" }, { label: b ? batchTitle(b) : `Batch ${bid}`, href: `#eduteria/b/${encodeURIComponent(bid)}` }, { label: sub ? (sub.name || sub.title) : `Subject ${sid}` }]);
    const key = `${bid}|${sid}`;
    if (!state.contents[key]) {
      view.innerHTML = skeleton("rows", 8);
      try { state.contents[key] = await getContents(bid, sid); }
      catch (e) {
        if (token !== navToken) return;
        view.innerHTML = errorBox(e.message, "eduRetry");
        $("#eduRetry").onclick = () => route();
        return;
      }
    }
    if (token !== navToken) return;
    const items = state.contents[key];
    $("#eduCount").textContent = `${items.length} item${items.length === 1 ? "" : "s"}`;
    if (!items.length) { view.innerHTML = '<div class="empty">No lectures in this subject yet.</div>'; return; }
    view.innerHTML = `<div class="edu-head"><h2>${esc(sub ? (sub.name || sub.title) : "Lectures")}</h2><p>Topics and lectures</p></div>
      <div class="search-box edu-inline-search"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/></svg><input id="eduLecSearch" type="search" placeholder="Search lectures..." autocomplete="off"></div>
      <div class="edu-rows" id="eduLecRows"></div>`;
    const rows = $("#eduLecRows");
    const draw = (q) => {
      const words = q.toLowerCase().split(/\s+/).filter(Boolean);
      const shown = items.filter((c) => words.every((w) => String(c.title || "").toLowerCase().includes(w)));
      rows.innerHTML = shown.length ? shown.map((c) => {
        const vid = c.videoId || c.id;
        const isDoc = c.type === "pdf" || c.type === "notes";
        return `<button class="edu-lec" type="button" data-id="${esc(c.id)}" data-vid="${esc(vid)}">
          <span class="edu-lec-thumb">${thumb(c.thumbnail)}<span class="edu-lec-play">${PLAY}</span></span>
          <span class="edu-lec-info"><span class="edu-lec-title">${esc(c.title || "Lecture")}</span><span class="edu-lec-sub">${isDoc ? "Notes / PDF" : c.isYouTube ? "YouTube lecture" : "Video lecture"}</span></span>
        </button>`;
      }).join("") : '<div class="empty">No lectures matched.</div>';
      rows.querySelectorAll(".edu-lec").forEach((btn) => btn.addEventListener("click", () => {
        const item = items.find((c) => String(c.id) === btn.dataset.id);
        state.current = item;
        location.hash = `#eduteria/b/${encodeURIComponent(bid)}/s/${encodeURIComponent(sid)}/v/${encodeURIComponent(btn.dataset.id)}?vid=${encodeURIComponent(btn.dataset.vid)}`;
      }));
    };
    draw("");
    $("#eduLecSearch").addEventListener("input", (e) => draw(e.target.value));
  }

  /* ---------- Player ---------- */
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const ex = document.querySelector(`script[data-lib="${src}"]`);
      if (ex) { ex.addEventListener("load", resolve); if (ex.dataset.done) resolve(); return; }
      const s = document.createElement("script");
      s.src = src; s.dataset.lib = src;
      s.onload = () => { s.dataset.done = "1"; resolve(); };
      s.onerror = () => reject(new Error("Could not load the video engine. Check your connection."));
      document.head.appendChild(s);
    });
  }

  function destroyPlayer() {
    const p = state.player;
    state.player = null;
    if (!p) return;
    try { p.destroy && p.destroy(); } catch (e) {}
  }

  function youtubeId(v) {
    const m = String(v || "").match(/^.*(youtu\.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/);
    if (m && m[2].length >= 10) return m[2];
    return /^[\w-]{11}$/.test(String(v || "")) ? v : null;
  }

  async function mountPlayer(box, d, title) {
    const url = d.fileUrl || "";
    const yt = d.isYouTube || (state.current && state.current.isYouTube) || /youtu\.?be/.test(url) || d.youtubeUrl;
    if (yt) {
      const id = youtubeId(d.youtubeUrl || url);
      if (id) {
        box.innerHTML = `<iframe src="https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}?autoplay=1&rel=0" title="${esc(title)}" allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture; fullscreen" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe>`;
        return;
      }
    }
    if (/\.pdf(\?|$)/i.test(url) && !d.isVideo) {
      box.innerHTML = `<iframe src="${esc(url)}" title="${esc(title)}"></iframe>`;
      return;
    }
    box.innerHTML = '<video id="eduVideo" controls playsinline autoplay preload="auto"></video>';
    const video = $("#eduVideo", box);
    const drm = d.drmConfig || {};
    if (/\.mpd(\?|$)/i.test(url) || drm.licenseUrl) {
      await loadScript(SHAKA_SRC);
      const shaka = window.shaka;
      shaka.polyfill.installAll();
      if (!shaka.Player.isBrowserSupported()) throw new Error("This browser cannot play DASH streams. Try Chrome, Edge or Firefox.");
      const player = new shaka.Player();
      await player.attach(video);
      state.player = player;
      if (drm.licenseUrl) {
        player.configure({ drm: { servers: { "com.widevine.alpha": drm.licenseUrl, "com.microsoft.playready": drm.licenseUrl, "org.w3.clearkey": drm.licenseUrl } } });
        const net = player.getNetworkingEngine();
        net.registerRequestFilter((type, req) => {
          if (type === shaka.net.NetworkingEngine.RequestType.LICENSE) {
            if (drm.authorization) req.headers.Authorization = drm.authorization;
            if (drm.pallyconCustomdataV2) req.headers["pallycon-customdata-v2"] = drm.pallyconCustomdataV2;
          }
        });
      }
      player.addEventListener("error", (e) => { if (e.detail && e.detail.severity === 2) showPlayerError(box, "Playback error (code " + e.detail.code + ")."); });
      await player.load(url);
    } else if (/\.m3u8(\?|$)/i.test(url)) {
      if (video.canPlayType("application/vnd.apple.mpegurl")) { video.src = url; }
      else {
        await loadScript(HLS_SRC);
        if (!window.Hls || !window.Hls.isSupported()) throw new Error("This browser cannot play HLS streams.");
        const hls = new window.Hls({ maxBufferLength: 30 });
        state.player = hls;
        hls.loadSource(url);
        hls.attachMedia(video);
        hls.on(window.Hls.Events.ERROR, (_, data) => { if (data.fatal) showPlayerError(box, "The stream could not be loaded."); });
      }
    } else if (url) {
      video.src = url;
    } else {
      throw new Error("No stream URL returned for this lecture.");
    }
    video.play().catch(() => {});
  }

  function showPlayerError(box, msg) {
    box.innerHTML = `<div class="edu-player-err"><p>${esc(msg)}</p></div>`;
  }

  async function showVideo(bid, sid, cid, vid, token) {
    const b = findBatch(bid);
    const sub = (state.subjects[bid] || []).find((s) => String(s.id) === String(sid));
    const item = state.current && String(state.current.id) === String(cid) ? state.current
      : (state.contents[`${bid}|${sid}`] || []).find((c) => String(c.id) === String(cid));
    state.current = item || null;
    const title = (item && item.title) || `Lecture ${cid}`;
    setCrumbs([{ label: "Home", href: "#home" }, { label: b ? batchTitle(b) : `Batch ${bid}`, href: `#eduteria/b/${encodeURIComponent(bid)}` }, { label: sub ? (sub.name || sub.title) : `Subject ${sid}`, href: `#eduteria/b/${encodeURIComponent(bid)}/s/${encodeURIComponent(sid)}` }, { label: title }]);
    $("#eduCount").textContent = "";
    const backHref = `#eduteria/b/${encodeURIComponent(bid)}/s/${encodeURIComponent(sid)}`;
    view.innerHTML = `<div class="edu-video"><div class="edu-player" id="eduPlayer">${skeleton("video")}</div>
      <div class="edu-video-meta"><h2>${esc(title)}</h2><div class="edu-video-actions"><a class="btn btn-quiet" href="${backHref}">\u2190 Back to lectures</a></div></div></div>`;
    const box = $("#eduPlayer");
    try {
      const d = await getVideo(vid);
      if (token !== navToken) return;
      if (d.error) throw new Error(d.error);
      if (d.success === false) throw new Error(d.message || "The video service returned an unsuccessful response.");
      if (!d.fileUrl && !d.youtubeUrl) throw new Error("No streaming URL found for this lecture.");
      await mountPlayer(box, d, title);
    } catch (e) {
      if (token !== navToken) return;
      box.innerHTML = `<div class="edu-player-err"><p>${esc(e.message || "Unable to load this video.")}</p><button class="btn btn-primary" type="button" id="eduRetry">Try again</button></div>`;
      $("#eduRetry").onclick = () => route();
    }
  }

  /* ---------- Router / tabs ---------- */
  function setActiveTab(edu) {
    document.querySelectorAll("#navLinks .nav-link").forEach((a) => {
      const href = a.getAttribute("href");
      a.classList.toggle("active", edu ? href === "#eduteria" : href === "#home" || href === "#courses" ? !edu && href === "#home" : false);
    });
    const bn = document.querySelector("#cxBnav");
    if (bn) bn.dataset.edu = edu ? "1" : "";
  }

  function route() {
    let h = location.hash || "";
    if (h === "#eduteria" || h === "#eduteria/") { history.replaceState(null, "", "#home"); h = "#home"; }
    const home = $("#homeView");
    const isEdu = h.startsWith("#eduteria");
    if (!root) return;
    root.hidden = !isEdu;
    if (home) home.hidden = isEdu;
    setActiveTab(isEdu);
    if (!isEdu) { navToken++; destroyPlayer(); return; }
    const token = ++navToken;
    destroyPlayer();
    const path = h.replace(/^#eduteria\/?/, "");
    const [main, query = ""] = path.split("?");
    const seg = main.split("/").filter(Boolean).map(decodeURIComponent);
    const vid = new URLSearchParams(query).get("vid");
    if (seg[0] === "b" && seg[1] && seg[2] === "s" && seg[3] && seg[4] === "v" && seg[5]) showVideo(seg[1], seg[3], seg[5], vid || seg[5], token);
    else if (seg[0] === "b" && seg[1] && seg[2] === "s" && seg[3]) showContents(seg[1], seg[3], token);
    else if (seg[0] === "b" && seg[1]) showSubjects(seg[1], token);
    else { history.replaceState(null, "", "#home"); route(); return; }
    window.scrollTo({ top: 0 });
  }

  function init() {
    root = $("#eduteriaView");
    if (!root) return;
    view = $("#eduView"); crumbs = $("#eduCrumbs");
    window.addEventListener("hashchange", route);
    document.addEventListener("click", (e) => {
      const home = e.target.closest && e.target.closest('#cxBnav button[data-n="home"], a.brand, a.qa-home');
      if (home && location.hash.startsWith("#eduteria")) { e.preventDefault(); location.hash = "#home"; }
    });
    document.addEventListener("cx:library-loaded", () => loadHomeBatches(true));
    document.addEventListener("cx:batches-retry", () => loadHomeBatches(true));
    if (window.__cxLibraryLoaded) loadHomeBatches(true);
    document.querySelectorAll("[data-go-eduteria]").forEach((el) => el.addEventListener("click", () => { location.hash = "#home"; }));
    route();
  }

  window.CXEduteria = { route, api: { getBatches, getSubjects, getContents, getVideo } };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
