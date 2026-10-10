// Runs in the page's own JS context (injected by content.js).
// Observes JSON the page already receives (fetch, XHR, inline <script> data)
// and forwards media URLs to the content script. It never makes requests itself.
(() => {
  const EVENT = 'sms:media';
  const MEDIA_HINT = /image_versions2|video_versions|"__typename":"(?:Photo|Video)"/;

  const area = (x) => (x.width || 0) * (x.height || 0);
  const largest = (list) => (list?.length ? list.reduce((a, b) => (area(b) > area(a) ? b : a)) : null);
  const fileKey = (url) => {
    try {
      return new URL(url).pathname.split('/').pop();
    } catch {
      return null;
    }
  };

  // The player usually streams a DASH rendition whose file name differs from video_versions.
  function dashFiles(manifest) {
    if (typeof manifest !== 'string') return [];
    return [...manifest.matchAll(/<BaseURL>([^<]+)<\/BaseURL>/g)].map((m) => fileKey(m[1].replace(/&amp;/g, '&')));
  }

  // <MPD mediaPresentationDuration="PT1M2.5S"> → 62.5
  function dashDuration(manifest) {
    const m = typeof manifest === 'string' && manifest.match(/mediaPresentationDuration="PT(?:(\d+)H)?(?:(\d+)M)?(?:([\d.]+)S)?"/);
    return m ? (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0) || null : null;
  }

  function toFiles(item) {
    const children = item.carousel_media?.length ? item.carousel_media : [item];
    return children
      .map((c) => {
        // CDN file names of every rendition, so content.js can match what's on screen.
        const keys = [...(c.video_versions || []), ...(c.image_versions2?.candidates || [])]
          .map((x) => fileKey(x.url))
          .concat(dashFiles(c.video_dash_manifest))
          .filter(Boolean);
        const video = largest(c.video_versions);
        if (video) return { kind: 'video', url: video.url, keys, duration: c.video_duration || dashDuration(c.video_dash_manifest) };
        const image = largest(c.image_versions2?.candidates);
        return image ? { kind: 'image', url: image.url, keys } : null;
      })
      .filter(Boolean);
  }

  // Field names for video length vary between Facebook surfaces; look for any of them.
  function findDuration(node, depth = 0) {
    if (!node || typeof node !== 'object' || depth > 3) return null;
    for (const [key, value] of Object.entries(node)) {
      if (typeof value === 'number' && value > 0 && /duration|length_in_second/i.test(key)) {
        return /ms/i.test(key) ? value / 1000 : value;
      }
    }
    for (const value of Object.values(node)) {
      const found = findDuration(value, depth + 1);
      if (found) return found;
    }
    return null;
  }

  // Raw Facebook video objects, kept for debugging from the page console (__smsVideos).
  const debugVideos = (window.__smsVideos = []);

  // Facebook describes media as { __typename: "Photo" | "Video", id, ... }.
  function facebookItem(node, ctx) {
    const id = String(node.id ?? '');
    if (!/^\d+$/.test(id)) return null;
    const owner = String(node.owner?.name || 'facebook').replace(/[^\p{L}\p{N}._-]+/gu, '_');
    const item = (file) => ({ code: null, pk: id, highlight: null, story: ctx.story, scopes: ctx.scopes, owner, files: [file] });

    if (node.__typename === 'Photo') {
      const images = [node.image, node.viewer_image, node.photo_image, node.full_image].filter((i) => i?.uri);
      const best = largest(images);
      if (!best) return null;
      return item({ kind: 'image', url: best.uri, keys: images.map((i) => fileKey(i.uri)).filter(Boolean) });
    }

    const legacy = node.videoDeliveryLegacyFields || {};
    const progressive = node.videoDeliveryResponseFragment?.videoDeliveryResponseResult?.progressive_urls || [];
    const urls = [
      legacy.browser_native_hd_url,
      node.browser_native_hd_url,
      node.playable_url_quality_hd,
      ...progressive.filter((p) => p.metadata?.quality === 'HD').map((p) => p.progressive_url),
      legacy.browser_native_sd_url,
      node.browser_native_sd_url,
      node.playable_url,
      ...progressive.map((p) => p.progressive_url),
    ].filter((u) => typeof u === 'string' && u.startsWith('http'));
    if (!urls.length) return null;
    const manifests = [
      node.dash_manifest,
      ...(node.videoDeliveryResponseFragment?.videoDeliveryResponseResult?.dash_manifests || []).map((m) => m.manifest_xml),
    ];
    const keys = urls.map(fileKey).concat(manifests.flatMap(dashFiles)).filter(Boolean);
    debugVideos.push(node);
    if (debugVideos.length > 30) debugVideos.shift();
    const duration = findDuration(node) ?? manifests.map(dashDuration).find(Boolean) ?? findDuration(ctx.storyNode);
    return item({ kind: 'video', url: urls[0], keys, duration });
  }

  // ctx carries what we know about the ancestors of the current node:
  //   highlight  Instagram highlight id ("highlight:<id>" reels)
  //   story      Facebook story card id, like "UzpfSVNDOj..." (base64 of "S:_ISC:…"),
  //              the same id that appears in /stories/<bucket>/<card id>/
  //   scopes     numeric ancestor ids, e.g. the Facebook highlight in /stories/<highlight id>/
  function walk(node, out, depth = 0, ctx = { highlight: null, story: null, storyNode: null, scopes: [] }) {
    if (!node || typeof node !== 'object' || depth > 80) return;
    if (Array.isArray(node)) {
      for (const x of node) walk(x, out, depth + 1, ctx);
      return;
    }
    if (typeof node.id === 'string' && node.id.startsWith('Uzpf')) ctx = { ...ctx, story: node.id, storyNode: node };
    if (typeof node.id === 'string' && /^\d+$/.test(node.id)) ctx = { ...ctx, scopes: [...ctx.scopes, node.id].slice(-6) };
    if (node.__typename === 'Photo' || node.__typename === 'Video') {
      const item = facebookItem(node, ctx);
      if (item) {
        out.push(item);
        return;
      }
    }
    if (typeof node.id === 'string' && node.id.startsWith('highlight:')) ctx = { ...ctx, highlight: node.id.slice('highlight:'.length) };
    // Posts and reels are keyed by shortcode; story items by pk (the id in /stories/<user>/<pk>/).
    const code = typeof node.code === 'string' ? node.code : null;
    const pk = typeof node.id === 'string' ? node.id.split('_')[0] : node.pk != null ? String(node.pk) : null;
    if ((code || pk) && (node.image_versions2 || node.video_versions || node.carousel_media)) {
      const files = toFiles(node);
      if (files.length) {
        out.push({ code, pk, highlight: ctx.highlight, owner: node.user?.username || node.owner?.username || '', files });
      }
      return; // carousel children are already covered by toFiles
    }
    for (const key in node) walk(node[key], out, depth + 1, ctx);
  }

  function emit(out) {
    if (out.length) document.dispatchEvent(new CustomEvent(EVENT, { detail: JSON.stringify(out) }));
  }

  function parseText(text) {
    if (!text || !MEDIA_HINT.test(text)) return;
    text = text.replace(/^for \(;;\);/, '');
    const out = [];
    try {
      walk(JSON.parse(text), out);
    } catch {
      // Some endpoints stream several JSON documents separated by newlines.
      for (const line of text.split('\n')) {
        try {
          walk(JSON.parse(line), out);
        } catch {}
      }
    }
    emit(out);
  }

  const originalFetch = window.fetch;
  window.fetch = async function (...args) {
    const response = await originalFetch.apply(this, args);
    try {
      const type = response.headers.get('content-type') || '';
      if (/json|javascript|text/.test(type)) response.clone().text().then(parseText, () => {});
    } catch {}
    return response;
  };

  const originalSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function (...args) {
    this.addEventListener('load', () => {
      try {
        if (this.responseType === '' || this.responseType === 'text') parseText(this.responseText);
        else if (this.responseType === 'json') {
          const out = [];
          walk(this.response, out);
          emit(out);
        }
      } catch {}
    });
    return originalSend.apply(this, args);
  };

  // Data for the first screen is embedded in the HTML, not fetched.
  function scanInlineScripts() {
    for (const script of document.querySelectorAll('script[type="application/json"]')) {
      parseText(script.textContent);
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', scanInlineScripts);
  else scanInlineScripts();
})();
