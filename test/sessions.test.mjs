// listDshSessions：未归档 / 排除子代理 / 排除空白 / 按最近使用排序
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-sessions-'));
const cacheDir = path.join(tmp, 'storages', 'session_projcache', 'sessions');
fs.mkdirSync(cacheDir, { recursive: true });
fs.mkdirSync(path.join(tmp, 'storages'), { recursive: true });

const writeSession = (id, { title = '', blank = false, lastPromptAt = 0, subagent = null, archived = false } = {}) => {
  const rows = {
    title: { val: title },
    sessionListMetadata: { val: { blank, lastPromptAt } },
    subagent: { val: subagent || {} }
  };
  fs.writeFileSync(path.join(cacheDir, `${id}.json`), JSON.stringify({
    record: { identity: { cwd: 'D:\\ws', createdAt: lastPromptAt }, rows }
  }), 'utf8');
  if (archived) archivedIds.push(id);
};
const archivedIds = [];

writeSession('normal-old', { title: '旧会话', lastPromptAt: 1000 });
writeSession('normal-new', { title: '新会话', lastPromptAt: 9000 });
writeSession('sub-agent', { title: '子代理', lastPromptAt: 9500, subagent: { identity: { mode: 'continuable', label: 'x' } } });
writeSession('blank-one', { title: '', lastPromptAt: 9600, blank: true });
writeSession('archived-one', { title: '已归档', lastPromptAt: 9700, archived: true });

fs.writeFileSync(path.join(tmp, 'storages', 'workspace.json'),
  JSON.stringify({ global: { archivedSessionIds: archivedIds } }), 'utf8');

process.env.DSH_HOME = tmp;

const mod = await import(pathToFileURL(path.resolve('./index.js')).href);
const list = mod.listDshSessions(10);
const ids = list.map((x) => x.id);

let pass = 0;
let fail = 0;
const check = (name, cond) => {
  if (cond) { pass += 1; console.log('  OK  ', name); } else { fail += 1; console.log('  FAIL', name); }
};

check('只保留普通未归档会话', JSON.stringify(ids) === JSON.stringify(['normal-new', 'normal-old']));
check('排除子代理', !ids.includes('sub-agent'));
check('排除空白会话', !ids.includes('blank-one'));
check('排除已归档', !ids.includes('archived-one'));
check('按最近使用排序', list[0].id === 'normal-new');
check('返回标题', list[0].title === '新会话');
check('limit 生效', mod.listDshSessions(1).length === 1);

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n通过 ${pass}，失败 ${fail}`);
process.exit(fail ? 1 : 0);
