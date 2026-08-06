// Allowlist editor. Each entry is a real Chrome host permission, requested
// with chrome.permissions.request() so the user sees Chrome's own prompt
// rather than us claiming access in our own UI.
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

function hostOf(pattern: string): string {
  return pattern.replace(/^\*:\/\//, '').replace(/\/\*$/, '');
}

async function read(): Promise<string[]> {
  const { [STORAGE_KEY]: list } = await chrome.storage.sync.get(STORAGE_KEY);
  return Array.isArray(list) ? (list as string[]) : [];
}

async function write(list: string[]): Promise<void> {
  await chrome.storage.sync.set({ [STORAGE_KEY]: list });
}

async function render(): Promise<void> {
  const list = await read();
  const ul = $('list');
  ul.innerHTML = '';
  if (list.length === 0) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = 'No sites yet. Add your ATS or CRM above to switch this on.';
    ul.appendChild(li);
    return;
  }
  for (const pattern of list) {
    const li = document.createElement('li');
    const code = document.createElement('code');
    code.textContent = hostOf(pattern);
    const btn = document.createElement('button');
    btn.textContent = 'Remove';
    btn.addEventListener('click', async () => {
      await chrome.permissions.remove({ origins: [pattern] }).catch(() => undefined);
      await write((await read()).filter((p) => p !== pattern));
      void render();
    });
    li.append(code, btn);
    ul.appendChild(li);
  }
}

$('add').addEventListener('click', async () => {
  const err = $('err');
  err.textContent = '';
  const input = $<HTMLInputElement>('host');
  const pattern = toPattern(input.value);
  if (!pattern) {
    err.textContent = 'Enter a site address, for example app.jobdiva.com';
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

void render();

export {};
