import { readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
export function accessLinks(dataDirectory, origin = 'http://localhost:3217/') {
  const url = new URL(origin);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/')
    throw new Error('配置先は https://example.com/ のようなルートURLで指定してください。');
  let keys;
  try { keys = JSON.parse(readFileSync(join(dataDirectory, '.access-links.json'), 'utf8')); }
  catch { throw new Error('先に共有サーバーをlinkモードで起動してください。'); }
  if (typeof keys.edit !== 'string' || typeof keys.view !== 'string' || !keys.edit || !keys.view || keys.edit === keys.view)
    throw new Error('共有リンクの設定が不正です。');
  const edit = new URL(url), view = new URL(url);
  edit.hash = new URLSearchParams({ key: keys.edit }).toString();
  view.searchParams.set('readonly', '1');
  view.hash = new URLSearchParams({ key: keys.view }).toString();
  return { edit: edit.href, view: view.href };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = Object.fromEntries(process.argv.slice(2).map(x => { const i = x.indexOf('='); return [x.slice(2, i), x.slice(i+1)]; }));
  try {
    const links = accessLinks(resolve(args['data-dir'] || process.env.DATA_DIR || '.runtime'), args['base-url'] || process.env.PUBLIC_ORIGIN || 'http://localhost:3217/');
    console.log('編集用: '+links.edit+'\n閲覧用: '+links.view);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
