import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {LifeEngine} from '../lib/engine.js';
import {sharedLifeContext} from '../lib/shared-context.js';

function fixture() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'state-view-'));
  const now = Date.now();
  const e = new LifeEngine({home, now: () => now});
  e.saveConfig({sessionIds: ['main'], semanticEnabled: false});
  e.state.active.push({id: 'soup', name: '煨汤', stage: 1, stageText: '小火慢炖', moodAdmission: 'admitted'});
  fs.mkdirSync(path.join(home, 'censhu-agency'), {recursive: true});
  fs.writeFileSync(path.join(home, 'censhu-agency', 'current.json'), JSON.stringify({
    sessionId: 'main', activity: '整理旧明信片', thought: '想起外婆的老相册', energy: 'tired',
    attentionCue: '留意青枔回信', judgment: '先慢慢理完一盒', until: now + 60000, at: now
  }));
  fs.writeFileSync(path.join(e.dir, 'recent-activity.json'), JSON.stringify({recent: [{sessionId: 'main', at: now, text: '聊过窗花'}]}));
  return {home, e, now};
}

// Every file under home with its bytes, to prove a read did not write anything.
const snapshotFiles = dir => {
  const out = {};
  const walk = d => { for (const f of fs.readdirSync(d, {withFileTypes: true})) { const p = path.join(d, f.name); if (f.isDirectory()) walk(p); else out[p] = fs.readFileSync(p, 'utf8'); } };
  walk(dir); return out;
};

test('browser interest in a bound session includes ongoing life events and what she is doing now', () => {
  const {home, e} = fixture();
  try {
    const view = sharedLifeContext(e, {}).browserInterests({sessionId: 'main'});
    assert.deepEqual(view.events, [{name: '煨汤', stage: '小火慢炖'}]);
    assert.equal(view.self.activity, '整理旧明信片');
    assert.equal(view.self.energy, 'tired');
    assert.equal(view.self.attentionCue, '留意青枔回信');
    assert.equal(view.self.judgment, '先慢慢理完一盒');
    assert.deepEqual(view.recent, ['聊过窗花']);
    assert.equal(sharedLifeContext(e, {}).browserInterests({sessionId: 'other'}), null, 'unbound sessions still get nothing here');
  } finally { fs.rmSync(home, {recursive: true, force: true}); }
});

test('unbound sessions get a read-only role state: no conversation activity, no writes', () => {
  const {home, e} = fixture();
  try {
    const before = snapshotFiles(home);
    const view = sharedLifeContext(e, {}).roleStateReadOnly();
    assert.equal(view.readOnly, true);
    assert.equal(view.scope, 'role-shared');
    assert.equal(view.self.activity, '整理旧明信片');
    assert.deepEqual(view.events, [{name: '煨汤', stage: '小火慢炖'}]);
    assert.equal('recent' in view, false, 'recent chat activity of the bound session is not exposed');
    assert.deepEqual(snapshotFiles(home), before, 'reading wrote nothing');
    e.saveConfig({sessionIds: ['main'], enabled: false});
    assert.equal(sharedLifeContext(e, {}).roleStateReadOnly(), null, 'nothing when the life plugin is off');
  } finally { fs.rmSync(home, {recursive: true, force: true}); }
});

test('viewing plugins see what she is doing now too', () => {
  const {home, e} = fixture();
  try {
    const context = sharedLifeContext(e, {}).douyinContext();
    assert.equal(context.self.activity, '整理旧明信片');
    assert.ok(Array.isArray(context.plans));
  } finally { fs.rmSync(home, {recursive: true, force: true}); }
});

test('an expired or foreign agency activity is not reported', () => {
  const {home, e, now} = fixture();
  try {
    fs.writeFileSync(path.join(home, 'censhu-agency', 'current.json'), JSON.stringify({sessionId: 'main', activity: '旧的', until: now - 1}));
    assert.equal(sharedLifeContext(e, {}).browserInterests({sessionId: 'main'}).self, null);
    fs.writeFileSync(path.join(home, 'censhu-agency', 'current.json'), JSON.stringify({sessionId: 'someone-else', activity: '别人的', until: now + 60000}));
    assert.equal(sharedLifeContext(e, {}).browserInterests({sessionId: 'main'}).self, null);
  } finally { fs.rmSync(home, {recursive: true, force: true}); }
});
