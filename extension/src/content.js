// Runs in the extension's isolated world.
// Keeps the media map fed by interceptor.js, shows one save button, and downloads
// files straight from the CDN — the same URLs the page already displays.
(() => {
  const media = new Map(); // shortcode or story pk -> { code, pk, owner, files: [{ kind, url, keys }] }
  const byFile = new Map(); // CDN file name -> { post, index }
  const CODE_RE = /\/(?:[\w.]+\/)?(?:p|reels?|tv)\/([\w-]+)/;
  const STORY_RE = /^\/stories\/(?!highlights\/)[^/]+\/(\d+)/;
  const HIGHLIGHT_RE = /^\/stories\/highlights\/(\d+)/;

  document.addEventListener('sms:media', (event) => {
    try {
      for (const post of JSON.parse(event.detail)) {
        if (post.code) media.set(post.code, post);
        if (post.pk) media.set(post.pk, post);
        post.files.forEach((file, index) => {
          for (const key of file.keys) byFile.set(key, { post, index });
        });
      }
    } catch {}
  });

  // Safari has no "world": "MAIN" for content scripts, so load the interceptor
  // into the page context as a regular script from the extension bundle.
  const script = document.createElement('script');
  script.src = (globalThis.browser ?? globalThis.chrome).runtime.getURL('src/interceptor.js');
  script.onload = () => script.remove();
  document.documentElement.appendChild(script);

  const codeFromHref = (href) => href?.match(CODE_RE)?.[1] ?? null;
  const fileKey = (url) => {
    try {
      return new URL(url).pathname.split('/').pop();
    } catch {
      return null;
    }
  };

  function visibleArea(el) {
    const r = el.getBoundingClientRect();
    const w = Math.min(r.right, innerWidth) - Math.max(r.left, 0);
    const h = Math.min(r.bottom, innerHeight) - Math.max(r.top, 0);
    return w > 0 && h > 0 ? w * h : 0;
  }

  function mostVisible(selector) {
    return [...document.querySelectorAll(selector)]
      .map((el) => ({ el, area: visibleArea(el) }))
      .filter((x) => x.area > 0)
      .sort((a, b) => b.area - a.area);
  }

  function codeForArticle(article) {
    for (const a of article.querySelectorAll('a[href]')) {
      const code = codeFromHref(a.getAttribute('href'));
      if (code) return code;
    }
    return null;
  }

  const wholePost = (post, id) => ({ owner: post.owner, id, files: post.files });

  // Highlights don't always put the current item in the URL: match the big
  // image/video on screen against the CDN file names we have seen.
  function onScreenItem() {
    const ranked = mostVisible('img, video');
    if (!ranked.length) return null;
    const minArea = ranked[0].area / 4;
    for (const { el, area } of ranked) {
      if (area < minArea) break;
      const sources = [el.currentSrc, el.src, el.poster, ...(el.srcset || '').split(',').map((s) => s.trim().split(' ')[0])];
      for (const src of sources) {
        if (!src?.startsWith('http')) continue;
        const hit = byFile.get(fileKey(src));
        if (hit) {
          const { post, index } = hit;
          const id = post.files.length > 1 ? `${post.code || post.pk}_${index + 1}` : post.code || post.pk;
          return { owner: post.owner, id, files: [post.files[index]] };
        }
      }
    }
    return null;
  }

  // Highlight videos play from a blob: stream with no CDN URL to match, so fall
  // back to comparing the playing video's duration with the highlight's items.
  function highlightVideoItem() {
    const highlight = location.pathname.match(HIGHLIGHT_RE)?.[1];
    const video = mostVisible('video')[0]?.el;
    if (!highlight || !video || !Number.isFinite(video.duration)) return null;
    const candidates = [...new Set(media.values())]
      .filter((post) => post.highlight === highlight && post.files[0]?.duration)
      .map((post) => ({ post, diff: Math.abs(post.files[0].duration - video.duration) }))
      .filter((x) => x.diff < 0.5)
      .sort((a, b) => a.diff - b.diff);
    if (candidates.length > 1) console.warn('[safari-media-saver] several highlight videos match by duration, using closest');
    const post = candidates[0]?.post;
    return post ? wholePost(post, post.pk) : null;
  }

  function debugDump() {
    console.warn('[safari-media-saver] nothing matched on', location.pathname, {
      known: media.size,
      onScreen: mostVisible('img, video')
        .slice(0, 4)
        .map(({ el, area }) => ({ tag: el.tagName, area: Math.round(area), src: el.currentSrc || el.src, poster: el.poster, duration: el.duration })),
    });
  }

  function resolveTarget() {
    const path = location.pathname;
    if (path.startsWith('/stories/')) {
      const pk = path.match(STORY_RE)?.[1];
      const post = pk && media.get(pk);
      return post ? wholePost(post, pk) : onScreenItem() ?? highlightVideoItem();
    }
    let code = codeFromHref(path);
    if (!code) {
      const article = mostVisible('article')[0]?.el;
      code = article && codeForArticle(article);
    }
    const post = code && media.get(code);
    return post ? wholePost(post, code) : onScreenItem();
  }

  function extensionFor(file, blob) {
    if (file.kind === 'video') return 'mp4';
    if (blob.type.includes('png')) return 'png';
    if (blob.type.includes('webp')) return 'webp';
    return 'jpg';
  }

  function saveBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }

  function flash(button, symbol) {
    button.textContent = symbol;
    setTimeout(() => {
      button.textContent = '⬇';
      button.disabled = false;
    }, 1500);
  }

  async function download(button) {
    const target = resolveTarget();
    if (!target) {
      debugDump();
      flash(button, '?');
      return;
    }
    button.disabled = true;
    button.textContent = '…';
    try {
      const multiple = target.files.length > 1;
      for (const [i, file] of target.files.entries()) {
        const response = await fetch(file.url, { credentials: 'omit' });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const blob = await response.blob();
        const name = [target.owner, target.id, multiple ? i + 1 : null].filter(Boolean).join('_');
        saveBlob(blob, `${name}.${extensionFor(file, blob)}`);
      }
      flash(button, '✓');
    } catch (error) {
      console.warn('[safari-media-saver] download failed', error);
      flash(button, '✕');
    }
  }

  const button = document.createElement('button');
  button.className = 'sms-btn';
  button.type = 'button';
  button.title = 'Save media';
  button.textContent = '⬇';
  button.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    download(button);
  });

  // Show the button wherever there is something to save: posts, reels, stories, feed.
  function render() {
    if (!document.body) return;
    const path = location.pathname;
    const show = Boolean(codeFromHref(path)) || path.startsWith('/stories/') || Boolean(document.querySelector('article'));
    if (show && !button.isConnected) document.body.appendChild(button);
    if (!show && button.isConnected) button.remove();
  }

  let scheduled = false;
  new MutationObserver(() => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      render();
    });
  }).observe(document.documentElement, { childList: true, subtree: true });
})();
