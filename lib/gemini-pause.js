// Pause control for every Gemini call that goes through situation.js googleStructured.
//
// Automatic pause: after a billing or auth refusal (HTTP 402/401/403) all callers, in every DSH
// process (2026-11-09: shared through the control file), pause for 15 minutes; each refusal right after a pause doubles it, up to 60 minutes. Any
// successful call clears it.
//
// Manual pause: started and ended from the "启动与中断恢复" page. It is kept in a small file under
// DSH_HOME so it survives a restart and is seen by every module instance that checks it.
// Ending it ("重新启动调用") also clears the automatic pause, e.g. right after a top-up.
//
// Paused calls make no request. The thrown error carries `paused: true` and `retryAt`, so callers
// can wait for the pause to end without counting it as a real failure.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const STEPS_MIN = [15, 30, 60];
const state = {until: 0, step: 0, status: 0, reason: '', setAt: 0};

export const PAUSE_STATUSES = new Set([401, 402, 403]);
export const geminiControlFile = () => path.join(process.env.DSH_HOME || path.join(os.homedir(), '.dsh'), 'cen-shu-life', 'gemini-pause.json');

let cache = {file: '', mtime: -1, value: {}};
function readControl() {
  const file = geminiControlFile();
  try {
    const mtime = fs.statSync(file).mtimeMs;
    if (cache.file !== file || cache.mtime !== mtime) cache = {file, mtime, value: JSON.parse(fs.readFileSync(file, 'utf8')) || {}};
  } catch { cache = {file, mtime: -1, value: {}}; }
  return cache.value;
}
function writeControl(value) {
  const file = geminiControlFile();
  fs.mkdirSync(path.dirname(file), {recursive: true});
  const tmp = file + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  fs.renameSync(tmp, file);
  cache = {file: '', mtime: -1, value: {}};
}
const clock = ms => new Date(ms).toLocaleTimeString('zh-CN', {timeZone: 'Asia/Shanghai', hour12: false});

function clearAuto() { state.until = 0; state.step = 0; state.status = 0; state.reason = ''; state.setAt = 0; }

export function geminiPauseStatus(now = Date.now()) {
  const control = readControl();
  const shared = control.auto;
  if (shared?.until > now && shared.setAt > state.setAt && !(control.resumedAt > shared.setAt)) Object.assign(state, {until: shared.until, step: shared.step, status: shared.status, reason: shared.reason, setAt: shared.setAt});
  if (control.resumedAt && control.resumedAt > state.setAt) clearAuto();
  const manual = control.manual ? {at: control.at || null, by: control.by || 'user'} : null;
  const auto = now < state.until ? {until: state.until, httpStatus: state.status, reason: state.reason} : null;
  return {paused: !!(manual || auto), manual, auto, resumedAt: control.resumedAt || null};
}

// Throws the pause error when paused; callers make no request in that case.
export function checkGeminiPause(now = Date.now()) {
  const status = geminiPauseStatus(now);
  if (status.manual) throw Object.assign(Error('Gemini 调用已在“启动与中断恢复”页面手动暂停；期间不发请求'), {code: 'GEMINI_PAUSED', paused: true, manual: true, retryAt: now + 60000});
  if (status.auto) throw Object.assign(Error(`Gemini 已暂停到 ${clock(status.auto.until)}（${status.auto.reason}）；期间不发请求`), {httpStatus: status.auto.httpStatus, code: 'GEMINI_PAUSED', paused: true, retryAt: status.auto.until});
}

export function noteGeminiError(error, now = Date.now()) {
  const status = Number(error?.httpStatus) || 0;
  if (!PAUSE_STATUSES.has(status) || error?.paused) return;
  state.step = Math.min(state.step + 1, STEPS_MIN.length);
  state.until = now + STEPS_MIN[state.step - 1] * 60000;
  state.status = status;
  state.reason = status === 402 ? '预付余额不足' : '认证或权限被拒';
  state.setAt = now;
  // A shared record is an optimization: if it cannot be written, this process still pauses.
  try { const {auto: _old, ...rest} = readControl(); writeControl({...rest, auto: {until: state.until, step: state.step, status, reason: state.reason, setAt: now}}); } catch {}
}

export function noteGeminiSuccess() {
  clearAuto();
  try { const {auto, ...rest} = readControl(); if (auto) writeControl(rest); } catch {}
}

export function pauseGeminiCalls({by = 'user', now = Date.now()} = {}) {
  const previous = readControl();
  writeControl({...previous, manual: true, at: now, by});
  return geminiPauseStatus(now);
}

export function resumeGeminiCalls({by = 'user', now = Date.now()} = {}) {
  writeControl({manual: false, resumedAt: now, by});
  clearAuto();
  return geminiPauseStatus(now);
}

// Test hook.
export function resetGeminiPause() { clearAuto(); cache = {file: '', mtime: -1, value: {}}; }
