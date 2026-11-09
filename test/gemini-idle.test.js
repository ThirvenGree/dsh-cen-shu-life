import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {LifeEngine} from '../lib/engine.js';
import {SocialExperience} from '../lib/social-experience.js';
import {checkGeminiPause,noteGeminiError,noteGeminiSuccess,geminiPauseStatus,resetGeminiPause,pauseGeminiCalls,resumeGeminiCalls,geminiControlFile} from '../lib/gemini-pause.js';

test('manual pause persists in DSH_HOME, blocks every call, and resume also lifts an automatic pause', () => {
  const previous = process.env.DSH_HOME, home = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-control-'));
  process.env.DSH_HOME = home;
  try {
    resetGeminiPause();
    const t = Date.parse('2026-11-05T21:00:00+08:00');
    pauseGeminiCalls({now: t});
    assert.ok(fs.existsSync(geminiControlFile()));
    assert.throws(() => checkGeminiPause(t + 1000), e => e.paused && e.manual && e.code === 'GEMINI_PAUSED' && e.retryAt === t + 61000);
    resetGeminiPause();
    assert.throws(() => checkGeminiPause(t + 2000), e => e.manual, 'still paused when read fresh (as after a restart)');
    noteGeminiError(Object.assign(Error('HTTP 402'), {httpStatus: 402}), t + 3000);
    const status = resumeGeminiCalls({now: t + 4000});
    assert.equal(status.paused, false);
    assert.equal(status.manual, null);
    checkGeminiPause(t + 5000);
    noteGeminiError(Object.assign(Error('HTTP 402'), {httpStatus: 402}), t + 6000);
    assert.throws(() => checkGeminiPause(t + 7000), e => e.paused && e.httpStatus === 402 && !e.manual && e.retryAt === t + 6000 + 15 * 60000, 'a later refusal pauses again');
  } finally {
    resetGeminiPause();
    if (previous === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = previous;
    fs.rmSync(home, {recursive: true, force: true});
  }
});

test('a billing or auth refusal pauses every Gemini caller, escalating up to an hour', () => {
  resetGeminiPause();
  const t0 = Date.parse('2026-11-05T10:00:00+08:00');
  checkGeminiPause(t0);
  noteGeminiError(Object.assign(Error('HTTP 503'), {httpStatus: 503}), t0);
  assert.equal(geminiPauseStatus(t0).paused, false, 'temporary errors do not pause');
  noteGeminiError(Object.assign(Error('HTTP 402'), {httpStatus: 402}), t0);
  assert.throws(() => checkGeminiPause(t0 + 60000), e => e.paused === true && e.httpStatus === 402 && e.code === 'GEMINI_PAUSED' && /预付余额不足/.test(e.message));
  assert.equal(geminiPauseStatus(t0).auto.until, t0 + 15 * 60000);
  noteGeminiError(Object.assign(Error('HTTP 402'), {httpStatus: 402}), t0 + 15 * 60000);
  assert.equal(geminiPauseStatus(t0 + 15 * 60000).auto.until, t0 + 45 * 60000, 'second refusal: 30 minutes');
  noteGeminiError(Object.assign(Error('HTTP 403'), {httpStatus: 403}), t0 + 45 * 60000);
  noteGeminiError(Object.assign(Error('HTTP 403'), {httpStatus: 403}), t0 + 105 * 60000);
  assert.equal(geminiPauseStatus(t0 + 105 * 60000).auto.until, t0 + 165 * 60000, 'capped at 60 minutes');
  noteGeminiError(Object.assign(Error('paused'), {httpStatus: 402, paused: true}), t0 + 105 * 60000);
  assert.equal(geminiPauseStatus(t0 + 105 * 60000).auto.until, t0 + 165 * 60000, 'a paused call does not extend the pause');
  noteGeminiSuccess();
  assert.equal(geminiPauseStatus(t0 + 106 * 60000).paused, false);
  checkGeminiPause(t0 + 106 * 60000);
  resetGeminiPause();
});

const now = Date.parse('2026-11-05T12:00:00+08:00');
async function fixture(fn) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'social-idle-'));
  try {
    const engine = new LifeEngine({home, now: () => now});
    engine.saveConfig({sessionIds: ['role'], enabled: true, semanticEnabled: true, lifeMoodEnabled: true, moodLinked: true});
    await fn(engine);
  } finally { fs.rmSync(home, {recursive: true, force: true}); }
}
const offerAll = (core, n) => { for (let i = 1; i <= n; i++) core.offer({sessionId: 'role', sourceId: 'call-' + i, tool: 'bili_interaction', text: '对方回复 ' + i, origin: 'bili', at: now - 20000}); };
const run = core => core.process(new AbortController().signal);
const formatError = () => Object.assign(Error('模型返回的 JSON 格式无效'), {code: 'MODEL_OUTPUT_FORMAT'});

test('a malformed answer halves the batch, then sets a stubborn record aside instead of looping', () => fixture(async engine => {
  const sizes = [];
  let failing = true;
  const core = new SocialExperience(engine, {judge: async ({observations}) => {
    sizes.push(observations.length);
    if (failing) throw formatError();
    return {events: []};
  }});
  offerAll(core, 8);
  await run(core); await run(core); await run(core);
  assert.equal(core.record.retryAt, now + 60000, 'a smaller batch is retried soon');
  await run(core);
  assert.deepEqual(sizes, [8, 4, 2, 1], 'batch halves after each malformed answer');
  assert.equal(core.record.retryAt, now + 5 * 60000, 'a single record failing waits the normal 5 minutes');
  await run(core); await run(core);
  assert.equal(core.status().setAside, 1, 'the single record failed three times and was set aside');
  assert.equal(core.status().pending, 7);
  assert.equal(core.record.setAside[0].sourceId, 'call-1');
  assert.match(core.record.setAside[0].reason, /格式无效/);
  failing = false;
  await run(core);
  assert.equal(core.status().pending, 6);
  assert.equal(core.status().batchSize, 2, 'a success grows the batch back');
}));

test('billing refusals wait 30 minutes and network errors 5 minutes, without shrinking the batch', () => fixture(async engine => {
  let error;
  const core = new SocialExperience(engine, {judge: async () => { throw error; }});
  offerAll(core, 8);
  error = Object.assign(Error('HTTP 402'), {httpStatus: 402});
  await run(core);
  assert.equal(core.record.retryAt, now + 30 * 60000);
  assert.equal(core.status().batchSize, 8);
  error = Object.assign(Error('Gemini 已暂停'), {httpStatus: 402, paused: true, code: 'GEMINI_PAUSED', retryAt: now + 12 * 60000});
  await run(core);
  assert.equal(core.record.retryAt, now + 12 * 60000, 'a paused call waits for the pause to end');
  error = Object.assign(Error('手动暂停'), {paused: true, manual: true, code: 'GEMINI_PAUSED', retryAt: now + 1000});
  await run(core);
  assert.equal(core.record.retryAt, now + 60000, 'at least one minute');
  error = Object.assign(Error('socket hang up'), {code: 'ECONNRESET'});
  await run(core);
  assert.equal(core.record.retryAt, now + 5 * 60000);
  assert.equal(core.status().batchSize, 8);
  assert.equal(core.status().pending, 8);
}));
