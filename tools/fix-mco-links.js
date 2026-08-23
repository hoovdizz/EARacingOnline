const fs = require('fs');
const path = require('path');

const root = path.resolve('MCO');
const textExtensions = new Set(['.html', '.htm', '.js', '.css']);
const files = [];
const imageFiles = [];

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(fullPath);
    else {
      if (textExtensions.has(path.extname(entry.name).toLowerCase())) files.push(fullPath);
      if (/\.(?:gif|jpe?g|png|webp|bmp)$/i.test(entry.name)) imageFiles.push(fullPath);
    }
  }
}

walk(root);

const imagesByName = new Map();
for (const imagePath of imageFiles) {
  const name = path.basename(imagePath).toLowerCase();
  if (!imagesByName.has(name)) imagesByName.set(name, []);
  imagesByName.get(name).push(imagePath);
}

const stats = {
  filesChanged: 0,
  remoteImagesLocalized: 0,
  remoteImagesDisabled: 0,
  eaLinksDisabled: 0,
  deadLocalLinksDisabled: 0,
  remoteCssImagesLocalized: 0,
  remoteCssImagesDisabled: 0,
};

if (process.argv.includes('--restore-external-check')) {
  let restored = 0;
  for (const file of files) {
    const original = fs.readFileSync(file, 'latin1');
    const source = original.replace(/<!-- Dead external link disabled; original href: (https?:\/\/.*?) --><a([^>]*?)href=(["'])javascript:void\(0\)\3([^>]*)>/gi,
      (match, url, before, quote, after) => {
        restored++;
        return `<a${before}href=${quote}${url}${quote}${after}>`;
      });
    if (source !== original) fs.writeFileSync(file, source, 'latin1');
  }
  console.log(`Restored external-check links: ${restored}`);
}

function isEaOrNfs(url) {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return hostname === 'ea.com' || hostname.endsWith('.ea.com') ||
      hostname === 'needforspeed.com' || hostname.endsWith('.needforspeed.com');
  } catch {
    return false;
  }
}

function localImageFor(url, sourceFile) {
  let pathname;
  try { pathname = new URL(url).pathname; } catch { return null; }
  const candidates = imagesByName.get(path.basename(pathname).toLowerCase()) || [];
  if (candidates.length !== 1) return null;
  return path.relative(path.dirname(sourceFile), candidates[0]).replace(/\\/g, '/');
}

function isDeadLocalHref(url, sourceFile) {
  if (!url || /^(?:#|javascript:|mailto:|tel:|data:)/i.test(url) || /^(?:https?:)?\/\//i.test(url)) return false;
  const clean = url.split(/[?#]/, 1)[0];
  if (!clean) return false;
  let target = clean.startsWith('/')
    ? path.join(root, clean.replace(/^\/+/, ''))
    : path.resolve(path.dirname(sourceFile), clean);
  try { target = decodeURIComponent(target); } catch {}
  return !fs.existsSync(target);
}

for (const file of files) {
  const original = fs.readFileSync(file, 'latin1');
  let source = original;

  // Make every remotely hosted HTML image local. Preserve its archival URL in a comment.
  source = source.replace(/(<img\b[^>]*?\bsrc\s*=\s*)(["'])(https?:\/\/.*?)\2/gi,
    (match, prefix, quote, url) => {
      const local = localImageFor(url, file);
      if (local) stats.remoteImagesLocalized++;
      else stats.remoteImagesDisabled++;
      return `<!-- Original remote image: ${url} -->${prefix}${quote}${local || ''}${quote}`;
    });

  // Do the same for legacy table/background attributes.
  source = source.replace(/(<(?:td|body|table)\b[^>]*?\bbackground\s*=\s*)(["'])(https?:\/\/.*?)\2/gi,
    (match, prefix, quote, url) => {
      const local = localImageFor(url, file);
      if (local) stats.remoteImagesLocalized++;
      else stats.remoteImagesDisabled++;
      return `<!-- Original remote image: ${url} -->${prefix}${quote}${local || ''}${quote}`;
    });

  // Localize CSS background images, including CSS embedded in HTML and legacy JS strings.
  source = source.replace(/url\(\s*(["']?)(https?:\/\/[^)'"\s]+)\1\s*\)/gi,
    (match, quote, url) => {
      const local = localImageFor(url, file);
      if (local) stats.remoteCssImagesLocalized++;
      else stats.remoteCssImagesDisabled++;
      return `/* Original remote image: ${url} */ url(${quote}${local || ''}${quote})`;
    });

  // Disable EA/NFS anchors and missing local targets while leaving their labels visible.
  source = source.replace(/<a\b([^>]*?)\bhref\s*=\s*(["'])(.*?)\2([^>]*)>/gi,
    (match, before, quote, url, after) => {
      const ea = isEaOrNfs(url);
      const deadLocal = isDeadLocalHref(url, file);
      if (!ea && !deadLocal) return match;
      if (ea) stats.eaLinksDisabled++;
      else stats.deadLocalLinksDisabled++;
      const reason = ea ? 'EA/NFS link disabled' : 'Dead local link disabled';
      return `<!-- ${reason}; original href: ${url} --><a${before}href=${quote}javascript:void(0)${quote}${after}>`;
    });

  // Disable direct EA/NFS JavaScript navigations, preserving the old URL as a JS comment.
  source = source.replace(/((?:window\.)?(?:location(?:\.href)?\s*=|open\s*\()\s*)(["'])(https?:\/\/[^"']*(?:ea\.com|needforspeed\.com)[^"']*)\2/gi,
    (match, prefix, quote, url) => {
      stats.eaLinksDisabled++;
      return `${prefix}/* EA/NFS link disabled; original URL: ${url} */ ${quote}${quote}`;
    });

  if (source !== original) {
    fs.writeFileSync(file, source, 'latin1');
    stats.filesChanged++;
  }
}

console.log(JSON.stringify(stats, null, 2));

const remainingExternalLinks = new Map();
for (const file of files) {
  const source = fs.readFileSync(file, 'latin1');
  for (const match of source.matchAll(/<a\b[^>]*?\bhref\s*=\s*(["'])(https?:\/\/.*?)\1/gi)) {
    const url = match[2];
    if (!remainingExternalLinks.has(url)) remainingExternalLinks.set(url, []);
    remainingExternalLinks.get(url).push(path.relative(root, file).replace(/\\/g, '/'));
  }
}

if (process.argv.includes('--list-external')) {
  console.log(JSON.stringify(Object.fromEntries(remainingExternalLinks), null, 2));
} else {
  console.log(`Remaining unique external hrefs: ${remainingExternalLinks.size}`);
}

async function checkUrl(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(url.trim(), {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'user-agent': 'Mozilla/5.0 MCO local archive link checker' },
    });
    return response.status < 400 || [401, 403, 429].includes(response.status);
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

async function disableDeadExternalLinks() {
  const urls = [...remainingExternalLinks.keys()];
  const dead = new Set();
  let cursor = 0;
  async function worker() {
    while (cursor < urls.length) {
      const url = urls[cursor++];
      if (!(await checkUrl(url))) dead.add(url);
    }
  }
  await Promise.all(Array.from({ length: 20 }, worker));

  let changedFiles = 0;
  let disabledLinks = 0;
  for (const file of files) {
    const original = fs.readFileSync(file, 'latin1');
    const source = original.replace(/<a\b([^>]*?)\bhref\s*=\s*(["'])(https?:\/\/.*?)\2([^>]*)>/gi,
      (match, before, quote, url, after) => {
        if (!dead.has(url)) return match;
        disabledLinks++;
        return `<!-- Dead external link disabled; original href: ${url} --><a${before}href=${quote}javascript:void(0)${quote}${after}>`;
      });
    if (source !== original) {
      fs.writeFileSync(file, source, 'latin1');
      changedFiles++;
    }
  }
  console.log(JSON.stringify({ checkedExternalUrls: urls.length, deadExternalUrls: dead.size, disabledLinks, changedFiles }, null, 2));
}

if (process.argv.includes('--disable-dead-external')) {
  disableDeadExternalLinks().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
