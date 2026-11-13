/* 公-4 片段：行内编辑/跳名册/改档位。从 sections.js 抽出（206 后） */
import { openChar, setOpenChar } from './shared.js';
import { setRole } from '../../core/state.js';
import { toast } from '../toast.js';
import { promptVarRows } from '../prompt-copy.js';
import { copyToClipboard } from './render.js';


export const MISC_ACTION_SET = new Set(['edit-char', 'goto-roster', 'set-role', 'copy-vars']);


export function handleMiscAction(action, target, id, host, isChange, rerender) {
    switch (action) {
        case 'copy-vars': {
            const text = promptVarRows().map((r) => r[0] + '  ' + r[1]).join('\n');
            copyToClipboard(text, target);
            toast.ok('变量清单已复制');
            break;
        }
                case 'edit-char': {
                    setOpenChar(String(openChar) === String(id) ? '' : String(id));
                    rerender();
                    break;
                }
                case 'goto-roster': {
                    /* ★ P2-7：人物那一区只给汇总，要看细节去名册（⛔ 在这里再列一遍 ✗） */
                    try {
                        const items = Array.from(document.querySelectorAll('button.wxg-ws-side-item'));
                        const hit = items.find((b2) => (b2.textContent || '').indexOf('人物名册') >= 0);
                        if (hit && typeof hit.click === 'function') {
                            hit.click();
                        } else {
                            toast.info('在左侧切到「人物名册」');
                        }
                    } catch (eGo) { toast.info('在左侧切到「人物名册」'); }
                    break;
                }
                case 'set-role': {
                    /* ★ B1：她手改六档 ⇒ 落库 + 记手改锁（autoRoster 不再动它） */
                    const okRole = setRole(id, String(target.value || ''));
                    if (okRole) {
                        toast.ok('档位已改为「' + String(target.value || '') + '」');
                        rerender();
                    } else {
                        toast.warn('这个档位不认识');
                    }
                    break;
                }
    }
}

