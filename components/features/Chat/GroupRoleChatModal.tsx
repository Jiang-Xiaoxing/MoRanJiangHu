import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { NPC结构, 场外对话消息结构 } from '../../../types';
import { 判断角色对话位置, 角色对话确认键 } from '../../../utils/roleChatLocation';

type GroupResult = { groupId: string; 新增消息: 场外对话消息结构[]; 发言次数: number; 结束原因: string };

interface Props {
    loading: boolean;
    环境: any;
    社交列表: NPC结构[];
    场外对话: 场外对话消息结构[];
    配置就绪: boolean;
    自动回复上限: number;
    气泡样式: 'single' | 'split';
    onSend: (params: {
        参与者NPCIds: string[];
        玩家输入: string;
        继续群聊?: boolean;
        首位NPCId?: string;
        群聊ID?: string;
        自动回复上限?: number;
        已确认全部位置?: boolean;
        onTurnDelta?: (payload: { npcId: string; npcName: string; text: string }) => void;
        onTurnComplete?: (payload: { message: 场外对话消息结构; turnIndex: number }) => void;
        shouldStopAfterTurn?: () => boolean;
    }) => Promise<GroupResult>;
    onStop: () => void;
    onDiscard: () => void;
    onClear: () => void;
    onClose: () => void;
    onSwitchToSingle: () => void;
    onOpenSettings?: () => void;
}

const 取ID = (npc: any): string => String(npc?.id || npc?.姓名 || '').trim();
const 分段 = (text: string, style: 'single' | 'split'): string[] => {
    const normalized = String(text || '').replace(/\r\n?/g, '\n').trim();
    if (!normalized) return [];
    return style === 'split' ? normalized.split(/\n\s*\n|\n/u).map(item => item.trim()).filter(Boolean) : [normalized];
};

const GroupRoleChatModal: React.FC<Props> = (props) => {
    const {
        loading, 环境, 社交列表, 场外对话, 配置就绪, 自动回复上限, 气泡样式,
        onSend, onStop, onDiscard, onClear, onClose, onSwitchToSingle, onOpenSettings
    } = props;
    const restoredGroup = useMemo(() => [...(Array.isArray(场外对话) ? 场外对话 : [])]
        .reverse()
        .find(item => item.会话类型 === 'group' && item.群聊ID && Array.isArray(item.听众NPCIds)), [场外对话]);
    const [selectedIds, setSelectedIds] = useState<string[]>(() => restoredGroup?.听众NPCIds || []);
    const [firstNpcId, setFirstNpcId] = useState('');
    const [confirmed, setConfirmed] = useState(false);
    const [draft, setDraft] = useState('');
    const [queuedText, setQueuedText] = useState('');
    const queuedTextRef = useRef('');
    const stopAfterTurnRef = useRef(false);
    const [sending, setSending] = useState(false);
    const [groupId, setGroupId] = useState(() => restoredGroup?.群聊ID || '');
    const [stream, setStream] = useState<{ npcId: string; npcName: string; text: string } | null>(null);
    const [liveMessages, setLiveMessages] = useState<场外对话消息结构[]>([]);
    const [error, setError] = useState('');
    const [notice, setNotice] = useState('');
    const listRef = useRef<HTMLDivElement | null>(null);

    const candidates = useMemo(() => (Array.isArray(社交列表) ? 社交列表 : [])
        .map(npc => ({ npc, id: 取ID(npc), check: 判断角色对话位置(npc, 环境) }))
        .filter(item => item.id)
        .sort((a, b) => {
            if (a.check.可选 !== b.check.可选) return a.check.可选 ? -1 : 1;
            const major = (b.npc?.是否主要角色 === true ? 1 : 0) - (a.npc?.是否主要角色 === true ? 1 : 0);
            return major || String(a.npc?.姓名 || '').localeCompare(String(b.npc?.姓名 || ''), 'zh-CN');
        }), [社交列表, 环境]);
    const selected = candidates.filter(item => selectedIds.includes(item.id));
    const currentMessages = useMemo(() => groupId
        ? 场外对话.filter(item => item.会话类型 === 'group' && item.群聊ID === groupId)
        : [], [场外对话, groupId]);

    const locationSignature = candidates.map(item => 角色对话确认键(item.npc, 环境)).join('|');
    const participantContextRef = useRef(`${locationSignature}::${selectedIds.join('|')}`);
    useEffect(() => {
        const nextContext = `${locationSignature}::${selectedIds.join('|')}`;
        if (participantContextRef.current === nextContext) return;
        participantContextRef.current = nextContext;
        setConfirmed(false);
        setGroupId('');
        setLiveMessages([]);
    }, [locationSignature, selectedIds.join('|')]);
    useEffect(() => {
        const el = listRef.current;
        if (el) el.scrollTop = el.scrollHeight;
    }, [currentMessages, liveMessages, stream]);

    const close = () => {
        onDiscard();
        onClose();
    };
    const toggleParticipant = (id: string) => {
        if (sending) return;
        setSelectedIds(prev => prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id]);
        setFirstNpcId(prev => prev === id ? '' : prev);
    };

    const runBatch = async (text: string, continueOnly = false) => {
        if (selectedIds.length < 2 || !confirmed || !配置就绪 || loading) return;
        setSending(true);
        setError('');
        setNotice('');
        setStream(null);
        setLiveMessages([]);
        stopAfterTurnRef.current = false;
        try {
            let nextText = text.trim();
            let shouldContinueOnly = continueOnly;
            let activeGroupId = groupId;
            do {
                setLiveMessages(shouldContinueOnly ? [] : [{
                    会话类型: 'group', 群聊ID: activeGroupId || 'pending', role: 'player', 发言人: '你',
                    内容: nextText, 时间: Date.now(), 完成状态: 'complete'
                }]);
                const result = await onSend({
                    参与者NPCIds: selectedIds,
                    玩家输入: nextText,
                    继续群聊: shouldContinueOnly,
                    首位NPCId: shouldContinueOnly ? undefined : firstNpcId || undefined,
                    群聊ID: activeGroupId || undefined,
                    自动回复上限,
                    已确认全部位置: true,
                    onTurnDelta: setStream,
                    onTurnComplete: ({ message }) => {
                        setStream(null);
                        setLiveMessages(prev => [...prev, message]);
                    },
                    shouldStopAfterTurn: () => stopAfterTurnRef.current
                });
                activeGroupId = result.groupId;
                setGroupId(result.groupId);
                setLiveMessages([]);
                setStream(null);
                setNotice(result.结束原因 === 'limit'
                    ? `已达到本次 ${自动回复上限} 条自动接话上限。`
                    : result.结束原因 === 'invalid_scheduler'
                        ? '角色发言已保留；调度信息无效，群聊已暂停。'
                        : result.结束原因 === 'request_error'
                            ? '已经完成的发言已保留；后续请求失败，群聊已暂停。'
                        : result.结束原因 === 'stopped' ? '群聊已暂停。' : '角色正在等你回应。');
                nextText = queuedTextRef.current.trim();
                queuedTextRef.current = '';
                setQueuedText('');
                stopAfterTurnRef.current = false;
                shouldContinueOnly = false;
            } while (nextText);
        } catch (e: any) {
            if (e?.name !== 'AbortError') setError(String(e?.message || e || '群聊请求失败'));
        } finally {
            setSending(false);
            setStream(null);
        }
    };

    const submit = () => {
        const text = draft.trim();
        if (!text) return;
        if (sending) {
            queuedTextRef.current = text;
            setQueuedText(text);
            setDraft('');
            stopAfterTurnRef.current = true;
            setNotice('已排队：当前角色说完后取消后续接话，再处理你的消息。');
            return;
        }
        setDraft('');
        void runBatch(text);
    };

    const renderMessage = (item: 场外对话消息结构, key: string) => {
        const player = item.role === 'player';
        const parts = 分段(item.内容, 气泡样式);
        return <div key={key} className={`flex flex-col gap-1 ${player ? 'items-end' : 'items-start'}`}>
            <div className={`text-[10px] ${player ? 'text-wuxia-gold/80' : 'text-wuxia-cyan/80'}`}>{item.发言人}{item.完成状态 === 'partial' ? '（未说完）' : ''}</div>
            {parts.map((part, index) => <div key={`${key}-${index}`} className={`max-w-[85%] rounded-xl px-3 py-2 text-sm leading-relaxed border whitespace-pre-wrap font-serif ${player ? 'bg-wuxia-gold/15 border-wuxia-gold/35 text-paper-white' : 'bg-black/40 border-gray-700/60 text-paper-white'}`}>{part}</div>)}
        </div>;
    };

    const busy = sending || loading;
    const canStart = 配置就绪 && !loading && selectedIds.length >= 2 && confirmed && (draft.trim().length > 0 || sending);

    return <div className="fixed inset-0 z-[230] bg-black/75 backdrop-blur-sm flex items-center justify-center p-3">
        <div className="w-full max-w-5xl h-[88vh] rounded-2xl border border-wuxia-gold/30 bg-ink-black/95 shadow-[0_20px_60px_rgba(0,0,0,0.7)] overflow-hidden flex flex-col">
            <div className="px-4 py-3 border-b border-gray-800/80 bg-black/40 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                    <button type="button" onClick={onSwitchToSingle} disabled={busy} className="px-3 py-1.5 rounded border border-gray-700 text-xs text-gray-300 disabled:opacity-40">单聊</button>
                    <button type="button" className="px-3 py-1.5 rounded border border-wuxia-gold/60 bg-wuxia-gold/15 text-xs text-wuxia-gold">群聊</button>
                </div>
                <div className="flex items-center gap-2">
                    {场外对话.length > 0 && <button type="button" onClick={onClear} disabled={busy} className="px-2 py-1 text-[11px] rounded border border-gray-700 text-gray-400 disabled:opacity-40">清空全部暂存</button>}
                    <button type="button" onClick={close} className="px-2 py-1 text-[11px] rounded border border-gray-700 text-gray-400 hover:text-white">关闭</button>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-[280px_1fr] flex-1 min-h-0">
                <div className="border-b md:border-b-0 md:border-r border-gray-800 p-3 overflow-y-auto custom-scrollbar space-y-2">
                    <div className="text-xs text-gray-300">选择至少两名角色</div>
                    {candidates.map(({ npc, id, check }) => <label key={id} className={`block rounded-lg border p-2 text-xs ${check.可选 ? 'border-gray-700 bg-black/25 cursor-pointer' : 'border-red-900/40 bg-red-950/10 opacity-65'}`}>
                        <div className="flex items-start gap-2">
                            <input type="checkbox" checked={selectedIds.includes(id)} onChange={() => toggleParticipant(id)} disabled={busy || (!check.可选 && !selectedIds.includes(id))} className="mt-0.5 accent-amber-500" />
                            <div className="min-w-0">
                                <div className="text-paper-white">{npc?.是否主要角色 === true ? '★ ' : ''}{npc?.姓名 || '未知'}</div>
                                <div className={check.状态 === 'blocked' ? 'text-red-300/80' : check.状态 === 'uncertain' ? 'text-amber-200/80' : 'text-gray-500'}>{check.原因}</div>
                                <div className="text-[10px] text-gray-600 truncate">位置：{check.地点摘要}</div>
                            </div>
                        </div>
                    </label>)}
                    {selected.length >= 2 && <div className="rounded-lg border border-amber-400/30 bg-amber-950/10 p-2 space-y-2">
                        <label className="flex items-start gap-2 text-[11px] text-amber-100">
                            <input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} disabled={busy} className="mt-0.5 accent-amber-500" />
                            <span>我确认所选角色此刻都在附近，能够听见这场对话。</span>
                        </label>
                        <label className="block text-[11px] text-gray-400">手动指定首位（可选）
                            <select value={firstNpcId} onChange={e => setFirstNpcId(e.target.value)} disabled={busy} className="mt-1 w-full bg-black/50 border border-gray-700 rounded p-1.5 text-gray-200">
                                <option value="">自动判断（点名优先）</option>
                                {selected.map(item => <option key={item.id} value={item.id}>{item.npc?.姓名}</option>)}
                            </select>
                        </label>
                    </div>}
                </div>

                <div className="flex flex-col min-h-0">
                    <div ref={listRef} className="flex-1 min-h-0 overflow-y-auto custom-scrollbar p-3 md:p-4 space-y-3">
                        {!配置就绪 && <div className="rounded-lg border border-amber-400/35 bg-amber-950/20 p-3 text-xs text-amber-100">请先开启角色对话独立模型并明确选择模型。{onOpenSettings && <button type="button" onClick={onOpenSettings} className="ml-2 underline">去设置</button>}</div>}
                        <div className="rounded-lg border border-wuxia-cyan/20 bg-wuxia-cyan/5 p-3 text-xs text-gray-300 leading-relaxed">每位角色发言会分别调用所选模型；本次最多自动接话 {自动回复上限} 条。聊天不直接改变物品、关系、时间或世界状态。</div>
                        {[...currentMessages, ...liveMessages].map((item, index) => renderMessage(item, `${item.时间}-${index}-${item.发言人}`))}
                        {stream && <div className="flex flex-col items-start gap-1"><div className="text-[10px] text-wuxia-cyan/80">{stream.npcName}</div>{分段(stream.text, 气泡样式).map((part, index) => <div key={index} className="max-w-[85%] rounded-xl px-3 py-2 text-sm border bg-black/40 border-gray-700/60 text-paper-white whitespace-pre-wrap font-serif">{part}</div>)}{!stream.text && <span className="inline-block w-2 h-4 bg-gray-500 animate-pulse" />}</div>}
                        {notice && <div className="text-xs text-amber-200/80">{notice}</div>}
                        {error && <div className="rounded border border-red-500/30 bg-red-950/20 p-2.5 text-xs text-red-200 whitespace-pre-wrap">{error}</div>}
                    </div>

                    <div className="border-t border-gray-800/80 bg-black/40 p-3 space-y-2">
                        {queuedText && <div className="text-[11px] text-amber-200">待插话：{queuedText}</div>}
                        <div className="flex items-end gap-2">
                            <textarea value={draft} onChange={e => setDraft(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } }} disabled={!配置就绪 || loading || selectedIds.length < 2 || !confirmed} rows={2} placeholder={sending ? '输入后发送，可排队插话…' : '对群聊中的角色说点什么…'} className="flex-1 min-w-0 bg-black/50 border border-gray-700 rounded-lg p-2.5 text-sm text-paper-white font-serif placeholder-gray-600 outline-none focus:border-wuxia-gold resize-none disabled:opacity-50" />
                            {sending && <button type="button" onClick={onStop} className="px-3 h-[46px] border border-red-500/50 text-red-200 rounded-lg text-xs">立即停止</button>}
                            <button type="button" onClick={submit} disabled={!canStart} className="px-4 h-[46px] bg-wuxia-gold text-ink-black rounded-lg font-bold text-sm disabled:opacity-40">{sending ? '排队插话' : '发送'}</button>
                        </div>
                        {!sending && groupId && <button type="button" onClick={() => void runBatch('', true)} disabled={!confirmed || loading} className="px-3 py-1.5 rounded border border-gray-700 text-xs text-gray-300 disabled:opacity-40">继续自动接话</button>}
                    </div>
                </div>
            </div>
        </div>
    </div>;
};

export default GroupRoleChatModal;
