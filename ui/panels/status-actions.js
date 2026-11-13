/* 公-4 片段：每轮记录开/关/上下条＋体检复制。从 sections.js 抽出（206 后） */
import { openRecordAt, setOpenRecordAt } from './shared.js';
import { toast } from '../toast.js';


export const STATUS_ACTION_SET = new Set(['open-record', 'record-close', 'record-prev', 'record-next', 'health-copy']);


export function handleStatusAction(action, target, id, host, isChange, rerender) {
    switch (action) {
                case 'open-record':
                    setOpenRecordAt(Math.max(0, Math.round(Number(id) || 0)));
                    rerender();
                    break;
                case 'record-close':
                    setOpenRecordAt(-1);
                    rerender();
                    break;
                case 'record-prev':
                case 'record-next':
                    if (openRecordAt >= 0) {
                        setOpenRecordAt(action === 'record-next' ? openRecordAt + 1 : openRecordAt - 1);
                        if (openRecordAt < 0) { openRecordAt = 0; }
                    }
                    rerender();
                    break;
                case 'health-copy': {
                    const pre = document.querySelector('#wxg-health-card pre');
                    const txt = pre ? String(pre.textContent || '') : '';
                    try {
                        if (navigator.clipboard && navigator.clipboard.writeText) {
                            navigator.clipboard.writeText(txt);
                            toast.ok('体检报告已复制（直接粘给我就行）');
                        } else {
                            toast.info('浏览器不让自动复制，你手选一下吧');
                        }
                    } catch (e) {
                        toast.info('复制没成（浏览器限制），你手选一下吧');
                    }
                    break;
                }
    }
}

