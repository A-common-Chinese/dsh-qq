// DSH 0.2.2 兼容性静态检查：废弃 API、引擎声明、服务注入
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0;
let fail = 0;
const check = (name, cond) => {
  if (cond) { pass += 1; console.log('  OK  ', name); } else { fail += 1; console.log('  FAIL', name); }
};

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const rawSrc = fs.readFileSync(path.join(ROOT, 'index.js'), 'utf8');
// 去掉注释行，避免"文档里提到废弃 API"被误判为"还在调用"
const src = rawSrc.split(/\r?\n/).filter((line) => {
  const t = line.trim();
  return !(t.startsWith('//') || t.startsWith('*') || t.startsWith('/*'));
}).join('\n');

check('版本号 0.3.0+', /^0\.3\./.test(pkg.version));
check('声明 engines.dsh', typeof pkg.engines?.dsh === 'string' && pkg.engines.dsh.includes('0.2.2'));
check('声明 engines.node 24+', typeof pkg.engines?.node === 'string' && /24/.test(pkg.engines.node));
check('bundle patch 仍在', pkg.dsh?.bundle?.patch === './cordis.patch.yml');

check('不再调用 session.snapshotEvents', !src.includes('snapshotEvents'));
check('不再调用 session.eventAt', !src.includes('eventAt'));
check('不再调用 session.ownEvents', !src.includes('ownEvents'));
check('schemastery 先试 @deepseek-ai/schemastery', src.includes("@deepseek-ai/schemastery"));
check('诊断改用 deriveMessages', src.includes('deriveMessages'));
check('注入 agents/sessions/tools/agentDefaultModel', /export const inject = \[[^\]]*'agents'[^\]]*'sessions'[^\]]*'tools'[^\]]*'agentDefaultModel'/.test(src));
check('仍导出 apply', /export function apply\(/.test(src));

console.log(`\n通过 ${pass}，失败 ${fail}`);
process.exit(fail ? 1 : 0);
