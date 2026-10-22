// Allowlist editor. Each entry is a real Chrome host permission, requested
// with chrome.permissions.request() so the user sees Chrome's own prompt
// rather than us claiming access in our own UI.
import { effectiveOpenIn } from './route';
import { BUILT_IN_HOSTS, hostOf, isBuiltIn } from './sites';

const STORAGE_KEY = 'allowedOrigins';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

function toPattern(input: string): string | null {
  let host = input.trim().toLowerCase();
  if (!host) return null;
  host = host.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  // Reject anything that isn't a plausible hostname; a bad pattern makes
  // permissions.request() throw rather than fail politely.
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(host)) return null;
  return `*://${host}/*`;
}


async function read(): Promise<string[]> {
  const { [STORAGE_KEY]: list } = await chrome.storage.sync.get(STORAGE_KEY);
  return Array.isArray(list) ? (list as string[]) : [];
}

/** Sites IT set by policy. Shown locked; a policy can name a site but can't
 *  grant access, so each still needs the user's one click on "Allow". */
async function readManaged(): Promise<{ origins: string[]; openIn: unknown }> {
  try {
    const m = await chrome.storage.managed.get(null);
    const origins = Array.isArray(m[STORAGE_KEY])
      ? (m[STORAGE_KEY] as unknown[]).filter((x): x is string => typeof x === 'string')
      : [];
    return { origins, openIn: m.openIn };
  } catch {
    return { origins: [], openIn: undefined }; // not managed
  }
}

async function isGranted(pattern: string): Promise<boolean> {
  try {
    return await chrome.permissions.contains({ origins: [pattern] });
  } catch {
    return false; // malformed policy pattern
  }
}

async function write(list: string[]): Promise<void> {
  await chrome.storage.sync.set({ [STORAGE_KEY]: list });
}

async function render(): Promise<void> {
  const [mine, managed] = await Promise.all([read(), readManaged()]);
  const ul = $('list');
  ul.innerHTML = '';

  // Granted at install by the manifest; there's nothing to add or remove.
  for (const host of BUILT_IN_HOSTS) {
    const li = document.createElement('li');
    const site = document.createElement('div');
    site.className = 'site';
    const code = document.createElement('code');
    code.textContent = host;
    const tag = document.createElement('span');
    tag.className = 'tag';
    tag.textContent = 'Built in';
    site.append(code, tag);
    li.append(site);
    ul.appendChild(li);
  }

  for (const pattern of managed.origins.filter((p) => !isBuiltIn(p))) {
    const li = document.createElement('li');
    const site = document.createElement('div');
    site.className = 'site';
    const code = document.createElement('code');
    code.textContent = hostOf(pattern);
    const tag = document.createElement('span');
    tag.className = 'tag';
    tag.textContent = 'Set by your administrator';
    site.append(code, tag);
    li.append(site);
    if (!(await isGranted(pattern))) {
      const btn = document.createElement('button');
      btn.className = 'primary';
      btn.textContent = 'Allow';
      btn.addEventListener('click', async () => {
        await chrome.permissions.request({ origins: [pattern] }).catch(() => false);
        void render();
      });
      li.append(btn);
    }
    ul.appendChild(li);
  }

  // A built-in site the user once added by hand stays in their synced list;
  // it's covered by the manifest now, so it isn't shown twice.
  const own = mine.filter((p) => !managed.origins.includes(p) && !isBuiltIn(p));
  for (const pattern of own) {
    const li = document.createElement('li');
    const site = document.createElement('div');
    site.className = 'site';
    const code = document.createElement('code');
    code.textContent = hostOf(pattern);
    site.append(code);
    li.append(site);
    // The list lives in chrome.storage.sync, the permission doesn't: after a
    // remove-and-reinstall, Chrome sync brings the list back without the
    // grant, and the scanner (which only registers granted sites) is silently
    // off while this page looked fine. Show it and offer the one click.
    if (!(await isGranted(pattern))) {
      const tag = document.createElement('span');
      tag.className = 'tag';
      tag.textContent = 'Not allowed yet';
      site.append(tag);
      const allow = document.createElement('button');
      allow.className = 'primary';
      allow.textContent = 'Allow';
      allow.addEventListener('click', async () => {
        await chrome.permissions.request({ origins: [pattern] }).catch(() => false);
        void render();
      });
      li.append(allow);
    }
    const btn = document.createElement('button');
    btn.textContent = 'Remove';
    btn.addEventListener('click', async () => {
      await chrome.permissions.remove({ origins: [pattern] }).catch(() => undefined);
      await write((await read()).filter((p) => p !== pattern));
      void render();
    });
    li.append(btn);
    ul.appendChild(li);
  }

  const { openIn } = await chrome.storage.sync.get('openIn');
  const eff = effectiveOpenIn(managed.openIn, openIn);
  for (const r of document.querySelectorAll<HTMLInputElement>('input[name="openIn"]')) {
    r.checked = r.value === eff.value;
  }
  $<HTMLFieldSetElement>('open-in').disabled = eff.locked;
  $('open-in-note').hidden = !eff.locked;
}

$('add').addEventListener('click', async () => {
  const err = $('err');
  err.textContent = '';
  const input = $<HTMLInputElement>('host');
  const pattern = toPattern(input.value);
  if (!pattern) {
    err.textContent = 'Enter a site address, for example crm.example.com';
    return;
  }
  if (isBuiltIn(pattern)) {
    err.textContent = `${hostOf(pattern)} is already built in.`;
    return;
  }
  let granted = false;
  try {
    granted = await chrome.permissions.request({ origins: [pattern] });
  } catch (e) {
    err.textContent = `Could not request access: ${(e as Error).message}`;
    return;
  }
  if (!granted) {
    err.textContent = 'Access was not granted, so this site was not added.';
    return;
  }
  const list = await read();
  if (!list.includes(pattern)) await write([...list, pattern]);
  input.value = '';
  void render();
});

$<HTMLInputElement>('host').addEventListener('keydown', (e) => {
  if ((e as KeyboardEvent).key === 'Enter') $('add').click();
});

for (const r of document.querySelectorAll<HTMLInputElement>('input[name="openIn"]')) {
  r.addEventListener('change', () => {
    if (r.checked) void chrome.storage.sync.set({ openIn: r.value });
  });
}

void render();

