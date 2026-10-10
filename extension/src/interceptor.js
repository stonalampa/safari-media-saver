// Runs in the page's own JS context (injected by content.js).
// Observes JSON the page already receives (fetch, XHR, inline <script> data)
// and forwards media URLs to the content script. It never makes requests itself.
(() => {
  const EVENT = 'sms:media';

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
        if (video) return { kind: 'video', url: video.url, keys, duration: c.video_duration || null };
        const image = largest(c.image_versions2?.candidates);
        return image ? { kind: 'image', url: image.url, keys } : null;
      })
      .filter(Boolean);
  }

  function walk(node, out, depth = 0, highlight = null) {
    if (!node || typeof node !== 'object' || depth > 80) return;
    if (Array.isArray(node)) {
      for (const x of node) walk(x, out, depth + 1, highlight);
      return;
    }
    // Remember which highlight a story item belongs to ("highlight:<id>" reels).
    if (typeof node.id === 'string' && node.id.startsWith('highlight:')) highlight = node.id.slice('highlight:'.length);
    // Posts and reels are keyed by shortcode; story items by pk (the id in /stories/<user>/<pk>/).
    const code = typeof node.code === 'string' ? node.code : null;
    const pk = typeof node.id === 'string' ? node.id.split('_')[0] : node.pk != null ? String(node.pk) : null;
    if ((code || pk) && (node.image_versions2 || node.video_versions || node.carousel_media)) {
      const files = toFiles(node);
      if (files.length) {
        out.push({ code, pk, highlight, owner: node.user?.username || node.owner?.username || '', files });
      }
      return; // carousel children are already covered by toFiles
    }
    for (const key in node) walk(node[key], out, depth + 1, highlight);
  }

  function emit(out) {
    if (out.length) document.dispatchEvent(new CustomEvent(EVENT, { detail: JSON.stringify(out) }));
  }

  function parseText(text) {
    if (!text || (!text.includes('image_versions2') && !text.includes('video_versions'))) return;
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
