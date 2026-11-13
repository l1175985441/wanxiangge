/* 提-1/提-2：提示词块与预设库事件。从 sections.js 抽出（206 后） */
import { getSettings, patchSettings, setAllPromptsDefault } from '../../core/settings.js';
import { listPresets, buildPreset, planApply, exportPresets, importPresets } from '../../core/preset.js';
import { undoLastMerge } from '../../core/merge.js';
import { stagingOf, stagingMode } from './shared.js';
import { byId } from './render.js';
import { trimText } from '../../core/utils.js';
import { toast } from '../toast.js';


export const PROMPT_ACTION_SET = new Set(['set-inject-header', 'apply-preset', 'undo-last-merge', 'delete-preset', 'save-preset', 'export-presets', 'import-presets', 'set-prompt-world', 'set-prompt-chars', 'set-jailbreak', 'show-jailbreak', 'toggle-layer-prompts', 'reset-prompts']);


export function handlePromptAction(action, target, id, host, isChange, rerender) {
    switch (action) {
                case 'set-inject-header': if (isChange) { patchSettings({ injectHeader: target.value }); toast.ok('保存了'); } break;
                case 'apply-preset': {
                    /* 4-a E3⑤：应用只改提示词（⛔ 重算） */
                    const selP = byId(host, 'wxg-preset-sel');
                    const plan = planApply(getSettings(), selP ? String(selP.value || '') : '');
                    if (!plan.ok) {
                        toast.bad('没应用成：' + String(plan.reason || '没选预设'));
                        break;
                    }
                    patchSettings(plan.patch);
                    toast.ok('已应用：' + plan.preset.name + '（改了 ' + String(plan.applied.length) + ' 块，未重算）');
                    rerender();
                    break;
                }
                case 'undo-last-merge': {
                    /* 1-b：选项②——真接上（失败就如实告诉她为什么） */
                    const rU = undoLastMerge();
                    if (rU.ok) {
                        toast.ok('已撤回上次合并（回到「' + String(rU.label || '合并前') + '」那一版；撤之前又压了一版，能再撤回来）');
                        rerender();
                    } else {
                        toast.bad('没撤成：' + String(rU.reason || '不知道原因'));
                    }
                    break;
                }
                case 'delete-preset': {
                    const selD = byId(host, 'wxg-preset-sel');
                    const idD = selD ? String(selD.value || '') : '';
                    const all = listPresets(getSettings());
                    const one = all.find((x) => x.id === idD);
                    if (!one) {
                        toast.bad('没选到要删的预设');
                        break;
                    }
                    if (one.builtin) {
                        toast.bad('内置预设不能删——要改就「另存为副本」。');
                        break;
                    }
                    const rest = (Array.isArray(getSettings().promptPresets) ? getSettings().promptPresets : []).filter((x) => String(x.id) !== idD);
                    patchSettings({ promptPresets: rest });
                    toast.ok('已删：' + one.name);
                    rerender();
                    break;
                }
                case 'save-preset': {
                    const nameInp = byId(host, 'wxg-preset-name');
                    const blockSel = byId(host, 'wxg-preset-block');
                    const which = blockSel ? String(blockSel.value || 'all') : 'all';
                    const blocks = {};
                    for (const b of [
                        { kind: 'world', key: 'promptWorld' },
                        { kind: 'chars', key: 'promptChars' },
                        { kind: 'jailbreak', key: 'jailbreak' },
                        { kind: 'header', key: 'injectHeader' },
                    ]) {
                        if (which === 'all' || which === b.kind) {
                            blocks[b.key] = effectivePrompt(b.kind);
                        }
                    }
                    const r = buildPreset(getSettings(), { name: nameInp ? String(nameInp.value || '') : '', blocks });
                    if (!r.ok) {
                        toast.bad('没存成：' + String(r.reason || '不合法'));
                        break;
                    }
                    const list = Array.isArray(getSettings().promptPresets) ? getSettings().promptPresets : [];
                    patchSettings({ promptPresets: list.concat([r.preset]) });
                    toast.ok('已存为预设：' + r.preset.name);
                    rerender();
                    break;
                }
                case 'export-presets': {
                    const io = byId(host, 'wxg-preset-io');
                    const pack = exportPresets(getSettings());
                    if (io) {
                        io.value = JSON.stringify(pack, null, 2);
                    }
                    toast.ok('已生成整包（' + String(pack.items.length) + ' 套）；下面那个框里复制就行');
                    break;
                }
                case 'import-presets': {
                    const io = byId(host, 'wxg-preset-io');
                    const raw = io ? String(io.value || '') : '';
                    let pack = null;
                    try {
                        pack = JSON.parse(raw);
                    } catch (eImp) {
                        toast.bad('导入失败：不是合法 JSON');
                        break;
                    }
                    const cfg = getSettings();
                    const out = importPresets(cfg, pack);
                    if (!out.ok) {
                        toast.bad('整包拒收：' + (out.rejects.slice(0, 2).join('；') || '不知道原因'));
                        break;
                    }
                    patchSettings({ promptPresets: cfg.promptPresets });
                    toast.ok('已导入 ' + String(out.added.length) + ' 套'
                        + (out.rejects.length ? '（跳过 ' + String(out.rejects.length) + ' 条）' : ''));
                    rerender();
                    break;
                }
                case 'set-prompt-world': if (isChange) { patchSettings({ promptWorld: target.value }); toast.ok('保存了'); } break;
                case 'set-prompt-chars': if (isChange) { patchSettings({ promptChars: target.value }); toast.ok('保存了'); } break;
                case 'set-jailbreak':
                    if (isChange) {
                        patchSettings({ jailbreak: target.value });
                        toast.ok(trimText(target.value) ? '破限词保存了' : '破限词清空了，会用内置那份');
                    }
                    break;
                case 'show-jailbreak': {
                    const box = byId(host, 'wxg-jailbreak-view');
                    if (box) {
                        box.style.display = box.style.display === 'none' ? 'block' : 'none';
                    }
                    break;
                }
                case 'toggle-layer-prompts': {
        patchSettings({ layerPrompts: target.checked === true });
        rerender();
        break;
    }

    case 'reset-prompts':
                    setAllPromptsDefault();
                    /*
                     * ⭐ ST9（材料 11·设置层）：**恢复内置默认后要连草稿一起清** ✓
                     *   旧：只调 setAllPromptsDefault() 清已存设置 ✗ ⇒ staging.prompts 草稿还在 ✗
                     *     ⇒ 保存条仍亮着“改了 N 处”✗ ⇒ 手滑一保存又把旧草稿盖回去 ✗
                     */
                    try {
                        const st9 = stagingOf(stagingMode);
                        if (st9 && typeof st9 === 'object') {
                            delete st9.prompts;
                        }
                    } catch (eSt9) { /* 清不掉也不能把恢复默认搞挂 ✓ */ }
                    toast.ok('三套提示词都恢复成内置默认了');
                    rerender();
                    break;
    }
}

