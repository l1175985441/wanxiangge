/* 公-1 片段：API 表单收拢（syncApiFromDom）＋ API_KEYS。从 shared.js 分出 */
import { stagingOf, stagingMode, stagingByMode } from './shared.js';
import { getSettings, patchSettings } from '../../core/settings.js';
import { trimText } from '../../core/utils.js';


export const API_KEYS = ['mode', 'url', 'key', 'model', 'modelCheap', 'temperature', 'maxTokens', 'materialCap', 'autoRetryMax', 'currentProfile'];

/**
 * ⭐⭐ 谷歌方案 A（她 2026-10-17 选定）：**DOM 即真相** ✓
 *   把当前面板 DOM 里填着的 API 各项**直接收拢并落盘** ✓
 *   为什么要有它：她填完地址/密钥/模型，可能还没点空白处失焦（或面板刚重画过 ✗），
 *   就直接点「测一下连接」「拉取模型」「另存为书签」或「保存」——
 *   这时候直接从当前面板的输入框读现值并落盘，100% 所见即所得，绝不绕弯 ✓
 *   （⛔ 不能只依赖“失焦时的 change 事件”——那只覆盖一种情形 ✗）
 */
export function syncApiFromDom(host) {
    if (!host || typeof host.querySelector !== 'function') {
        return;
    }
    const cur = Object.assign({}, getSettings().api || {});
    const draft = (stagingOf(stagingMode) && stagingOf(stagingMode).api) || {};
    for (const k of Object.keys(draft)) {
        if (k === 'api' && draft.api && typeof draft.api === 'object') {
            Object.assign(cur, draft.api);
        } else if (API_KEYS.includes(k)) {
            cur[k] = draft[k];
        }
    }
    const readVal = (id) => {
        const elNode = host.querySelector('#' + id);
        return elNode && typeof elNode.value === 'string' ? elNode.value : null;
    };
    const modeVal = readVal('wxg-api-mode');
    if (modeVal !== null && modeVal.indexOf('profile:') !== 0) {
        cur.mode = trimText(modeVal) === 'direct' ? 'direct' : 'proxy';
    }
    const urlVal = readVal('wxg-api-url');
    if (urlVal !== null) { cur.url = trimText(urlVal); }
    const keyVal = readVal('wxg-api-key');
    if (keyVal !== null) { cur.key = trimText(keyVal); }
    const modelVal = readVal('wxg-api-model');
    if (modelVal !== null) { cur.model = trimText(modelVal); }
    const cheapVal = readVal('wxg-api-model-cheap');
    if (cheapVal !== null) { cur.modelCheap = trimText(cheapVal); }
    const tempVal = readVal('wxg-api-temp-code');
    if (tempVal !== null && trimText(tempVal) !== '') { cur.temperature = Number(tempVal); }
    const maxTokVal = readVal('wxg-api-maxtok');
    if (maxTokVal !== null && trimText(maxTokVal) !== '') { cur.maxTokens = Number(maxTokVal); }
    const matCapVal = readVal('wxg-api-material-cap');
    if (matCapVal !== null && trimText(matCapVal) !== '') { cur.materialCap = Number(matCapVal); }
    const retryVal = readVal('wxg-auto-retry-max');
    if (retryVal !== null && trimText(retryVal) !== '') { cur.autoRetryMax = Number(retryVal); }
    /* ★ 20261023 她拍板的三格：不读的话存不进去 ✗ */
    const extraBodyVal = readVal('wxg-api-extra-body');
    if (extraBodyVal !== null) { cur.extraBody = String(extraBodyVal); }
    const excludeBodyVal = readVal('wxg-api-exclude-body');
    if (excludeBodyVal !== null) { cur.excludeBody = String(excludeBodyVal); }
    const extraHeadersVal = readVal('wxg-api-extra-headers');
    if (extraHeadersVal !== null) { cur.extraHeaders = String(extraHeadersVal); }

    for (const m of Object.keys(stagingByMode)) {
        if (stagingByMode[m]) {
            delete stagingByMode[m].api;
        }
    }
    patchSettings({ api: cur });
}

/**
 * ⭐ `stage-*` 动作总表：动作名 → [这一段, 设置键, 取值方式]。
 * 有了它，各处控件只要把 `set-xxx` 写成 `stage-xxx` 就进了草稿，⛔ 不用每个都写一个 case。
 */

