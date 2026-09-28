import React, { useEffect, useMemo, useRef, useState } from 'react';
import { NPC结构, 场外对话消息结构 } from '../../../types';
import { 判断角色对话位置, 角色对话确认键 } from '../../../utils/roleChatLocation';
import GroupRoleChatModal from './GroupRoleChatModal';

interface Props {
    open: boolean;
    loading: boolean; // 主回合生成中
    环境: any;
    社交列表: NPC结构[];
    场外对话: 场外对话消息结构[];
    配置就绪: boolean;
    onSend: (params: {
        npcId?: string;
        npcName?: string;
        玩家输入: string;
        已确认位置?: boolean;
        onDelta?: (delta: string, accumulated: string) => void;
    }) => Promise<{ reply: string; npcName: string }>;
    onGroupSend: React.ComponentProps<typeof GroupRoleChatModal>['onSend'];
    onStop: () => void;
    onDiscard: () => void;
    onClear: () => void;
    onClose: () => void;
    onOpenSettings?: () => void;
    群聊开启: boolean;
    自动回复上限: number;
    单聊气泡样式: 'single' | 'split';
    群聊气泡样式: 'single' | 'split';
}

// 「角色对话」侧聊面板：与单个在场 NPC 场外对话。
// 对话只暂存（场外对话 state），下次提交行动时打包注入主回合，成功后自动清空。
const RoleChatModal: React.FC<Props> = ({
    open,
    loading,
    环境,
    社交列表,
    场外对话,
    配置就绪,
    onSend,
    onGroupSend,
    onStop,
    onDiscard,
    onClear,
    onClose,
    onOpenSettings,
    群聊开启,
    自动回复上限,
    单聊气泡样式,
    群聊气泡样式
}) => {
    const [mode, setMode] = useState<'single' | 'group'>('single');
    const [selectedNpcId, setSelectedNpcId] = useState('');
    const [draft, setDraft] = useState('');
    const [sending, setSending] = useState(false);
    const [streamText, setStreamText] = useState('');
    const [error, setError] = useState('');
    const [confirmedKey, setConfirmedKey] = useState('');
    const listRef = useRef<HTMLDivElement | null>(null);

    const NPC候选 = useMemo(() => {
        return (Array.isArray(社交列表) ? 社交列表 : [])
            .map((npc) => ({ npc, check: 判断角色对话位置(npc, 环境) }))
            .slice()
            .sort((a, b) => {
                if (a.check.可选 !== b.check.可选) return a.check.可选 ? -1 : 1;
                const majorDiff = (b.npc?.是否主要角色 === true ? 1 : 0) - (a.npc?.是否主要角色 === true ? 1 : 0);
                if (majorDiff !== 0) return majorDiff;
                return String(a.npc?.姓名 || '').localeCompare(String(b.npc?.姓名 || ''), 'zh-CN');
            });
    }, [社交列表, 环境]);
    const 在场NPC列表 = useMemo(() => NPC候选.filter(item => item.check.可选).map(item => item.npc), [NPC候选]);

    // 按目标 NPC 隔离：面板只显示「正在对话的这名角色」的暂存，避免换人后串看/串注入。
    const 当前对话 = useMemo(() => {
        const list = Array.isArray(场外对话) ? 场外对话 : [];
        const target = 在场NPC列表.find((npc) => String(npc?.id || npc?.姓名 || '') === selectedNpcId) || 在场NPC列表[0] || null;
        const key = String(target?.id || '') || String(target?.姓名 || '');
        if (!key) return [];
        return list.filter((item) => item.会话类型 !== 'group' && String(item?.npcId || '') === key);
    }, [场外对话, 在场NPC列表, selectedNpcId]);

    useEffect(() => {
        if (!open) return;
        setError('');
        setStreamText('');
        setConfirmedKey('');
        setSelectedNpcId((prev) => {
            if (prev && 在场NPC列表.some((npc) => String(npc?.id || npc?.姓名 || '') === prev)) return prev;
            return String(在场NPC列表[0]?.id || 在场NPC列表[0]?.姓名 || '');
        });
    }, [open, 在场NPC列表]);

    useEffect(() => {
        if (!open) return;
        const el = listRef.current;
        if (el) el.scrollTop = el.scrollHeight;
    }, [open, 场外对话, streamText]);

    if (!open) return null;

    const selectedNpc = 在场NPC列表.find((npc) => String(npc?.id || npc?.姓名 || '') === selectedNpcId)
        || 在场NPC列表[0]
        || null;
    const busy = sending || loading;
    const selectedCheck = selectedNpc ? 判断角色对话位置(selectedNpc, 环境) : null;
    const selectedConfirmKey = selectedNpc ? 角色对话确认键(selectedNpc, 环境) : '';
    const locationConfirmed = Boolean(selectedConfirmKey && confirmedKey === selectedConfirmKey);
    const canSend = 配置就绪 && !busy && Boolean(selectedNpc) && locationConfirmed && draft.trim().length > 0;

    const handleSend = async () => {
        const text = draft.trim();
        if (!text || !selectedNpc || busy) return;
        setSending(true);
        setError('');
        setStreamText('');
        try {
            await onSend({
                npcId: String(selectedNpc?.id || ''),
                npcName: String(selectedNpc?.姓名 || ''),
                玩家输入: text,
                已确认位置: true,
                onDelta: (_delta, accumulated) => setStreamText(accumulated)
            });
            setDraft('');
        } catch (e: any) {
            setError(String(e?.message || e || '角色对话请求失败'));
        } finally {
            setStreamText('');
            setSending(false);
        }
    };

    if (mode === 'group' && 群聊开启) {
        return <GroupRoleChatModal
            loading={loading}
            环境={环境}
            社交列表={社交列表}
            场外对话={场外对话}
            配置就绪={配置就绪}
            自动回复上限={自动回复上限}
            气泡样式={群聊气泡样式}
            onSend={onGroupSend}
            onStop={onStop}
            onDiscard={onDiscard}
            onClear={onClear}
            onClose={onClose}
            onSwitchToSingle={() => setMode('single')}
            onOpenSettings={onOpenSettings}
        />;
    }

    const renderBubble = (item: 场外对话消息结构, index: number) => {
        const isPlayer = item.role === 'player';
        return (
            <div key={`role-chat-${index}-${item.时间}`} className={`flex ${isPlayer ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[85%] rounded-xl px-3 py-2 text-sm leading-relaxed border ${
                    isPlayer
                        ? 'bg-wuxia-gold/15 border-wuxia-gold/35 text-paper-white'
                        : 'bg-black/40 border-gray-700/60 text-paper-white'
                }`}>
                    <div className={`text-[10px] mb-0.5 ${isPlayer ? 'text-wuxia-gold/80 text-right' : 'text-wuxia-cyan/80'}`}>
                        {item.发言人}
                    </div>
                    {(单聊气泡样式 === 'split' ? item.内容.replace(/\r\n?/g, '\n').split(/\n\s*\n|\n/u).filter(Boolean) : [item.内容]).map((part, partIndex) => (
                        <div key={partIndex} className={`${partIndex > 0 ? 'mt-1.5 pt-1.5 border-t border-white/5' : ''} whitespace-pre-wrap font-serif`}>{part.trim()}</div>
                    ))}
                </div>
            </div>
        );
    };

    return (
        <div className="fixed inset-0 z-[230] bg-black/75 backdrop-blur-sm flex items-center justify-center p-3">
            <div className="w-full max-w-3xl h-[85vh] rounded-2xl border border-wuxia-gold/30 bg-ink-black/95 shadow-[0_20px_60px_rgba(0,0,0,0.7)] overflow-hidden flex flex-col">
                <div className="px-4 py-3 border-b border-gray-800/80 bg-black/40 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-3 min-w-0">
                        <div className="flex items-center gap-1 shrink-0">
                            <button type="button" className="px-3 py-1.5 rounded border border-wuxia-gold/60 bg-wuxia-gold/15 text-xs text-wuxia-gold">单聊</button>
                            {群聊开启 && <button type="button" onClick={() => setMode('group')} disabled={busy} className="px-3 py-1.5 rounded border border-gray-700 text-xs text-gray-300 disabled:opacity-40">群聊</button>}
                        </div>
                        <select
                            value={selectedNpcId}
                            onChange={(e) => setSelectedNpcId(e.target.value)}
                            disabled={busy || 在场NPC列表.length === 0}
                            className="max-w-[220px] bg-black/60 border border-gray-700 rounded px-2 py-1 text-xs text-paper-white outline-none focus:border-wuxia-gold disabled:opacity-50"
                        >
                            {在场NPC列表.length === 0 && <option value="">（当前没有在场角色）</option>}
                            {在场NPC列表.map((npc) => (
                                <option key={String(npc?.id || npc?.姓名)} value={String(npc?.id || npc?.姓名 || '')}>
                                    {npc?.是否主要角色 === true ? '★ ' : ''}{npc?.姓名 || '未知'}
                                </option>
                            ))}
                        </select>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                        {场外对话.length > 0 && (
                            <button
                                type="button"
                                onClick={() => { if (!busy) onClear(); }}
                                disabled={busy}
                                className="px-2 py-1 text-[11px] rounded border border-gray-700 text-gray-400 hover:text-red-300 hover:border-red-400/50 disabled:opacity-40"
                                title="清空所有角色的暂存场外对话（不会注入主回合）"
                            >
                                清空全部暂存
                            </button>
                        )}
                        <button
                            type="button"
                            onClick={() => { onDiscard(); onClose(); }}
                            className="px-2 py-1 text-[11px] rounded border border-gray-700 text-gray-400 hover:text-white"
                        >
                            关闭
                        </button>
                    </div>
                </div>

                <div ref={listRef} className="flex-1 min-h-0 overflow-y-auto custom-scrollbar p-3 md:p-4 space-y-2.5">
                    {!配置就绪 && (
                        <div className="rounded-lg border border-amber-400/35 bg-amber-950/20 p-3 text-xs text-amber-100 leading-relaxed space-y-2">
                            <div>角色对话需要先在设置里开启「角色对话独立模型」并选择模型（不会回退到主剧情模型）。建议配一个便宜、响应快的小模型。</div>
                            {onOpenSettings && (
                                <button
                                    type="button"
                                    onClick={onOpenSettings}
                                    className="px-3 py-1.5 rounded border border-amber-400/50 text-amber-100 hover:bg-amber-400/10"
                                >
                                    去设置 → 角色对话
                                </button>
                            )}
                        </div>
                    )}
                    {在场NPC列表.length === 0 && (
                        <div className="rounded-lg border border-gray-700 bg-black/30 p-3 text-xs text-gray-400 leading-relaxed">
                            当前场景没有在场角色：先推进剧情让角色登场，再回来找他对话。
                        </div>
                    )}
                    {selectedNpc && selectedCheck && (
                        <label className={`flex items-start gap-2 rounded-lg border p-3 text-xs leading-relaxed ${selectedCheck.状态 === 'uncertain' ? 'border-amber-400/35 bg-amber-950/15 text-amber-100' : 'border-wuxia-cyan/25 bg-wuxia-cyan/5 text-gray-300'}`}>
                            <input
                                type="checkbox"
                                checked={locationConfirmed}
                                onChange={(e) => setConfirmedKey(e.target.checked ? selectedConfirmKey : '')}
                                disabled={busy}
                                className="mt-0.5 accent-amber-500"
                            />
                            <span><span className="font-bold">确认能够交谈：</span>{selectedCheck.原因}<br /><span className="text-[10px] opacity-70">记录位置：{selectedCheck.地点摘要}</span></span>
                        </label>
                    )}
                    {NPC候选.some(item => !item.check.可选) && (
                        <details className="rounded-lg border border-gray-800 bg-black/20 p-2 text-[11px] text-gray-500">
                            <summary className="cursor-pointer">查看当前不能直接交谈的角色</summary>
                            <div className="mt-2 space-y-1">
                                {NPC候选.filter(item => !item.check.可选).map(item => <div key={String(item.npc?.id || item.npc?.姓名)}>{item.npc?.姓名 || '未知'}：{item.check.原因}</div>)}
                            </div>
                        </details>
                    )}
                    {配置就绪 && 当前对话.length === 0 && selectedNpc && (
                        <div className="rounded-lg border border-wuxia-cyan/25 bg-wuxia-cyan/5 p-3 text-xs text-gray-300 leading-relaxed">
                            正在与【{selectedNpc?.姓名}】私下交谈。这里的话不消耗游戏时间、不直接改变世界；
                            暂存的对话会在你下次提交行动时一并交给主剧情处理，成功后自动清空。
                        </div>
                    )}
                    {当前对话.map(renderBubble)}
                    {sending && (
                        <div className="flex justify-start">
                            <div className="max-w-[85%] rounded-xl px-3 py-2 text-sm leading-relaxed border bg-black/40 border-gray-700/60 text-paper-white">
                                <div className="text-[10px] mb-0.5 text-wuxia-cyan/80">{selectedNpc?.姓名 || 'NPC'}</div>
                                <div className="whitespace-pre-wrap font-serif">
                                    {streamText || <span className="inline-block w-2 h-4 bg-gray-500 animate-pulse" />}
                                </div>
                            </div>
                        </div>
                    )}
                    {error && (
                        <div className="rounded border border-red-500/30 bg-red-950/20 p-2.5 text-xs text-red-200 whitespace-pre-wrap">
                            {error}
                        </div>
                    )}
                </div>

                <div className="border-t border-gray-800/80 bg-black/40 p-3 space-y-2">
                    <div className="flex items-end gap-2">
                        <textarea
                            value={draft}
                            onChange={(e) => setDraft(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter' && !e.shiftKey) {
                                    e.preventDefault();
                                    void handleSend();
                                }
                            }}
                            disabled={!配置就绪 || loading || !selectedNpc || !locationConfirmed}
                            rows={2}
                            placeholder={
                                loading
                                    ? '主回合生成中，暂不能对话…'
                                    : (selectedNpc ? `对【${selectedNpc.姓名}】说点什么…（Enter 发送，Shift+Enter 换行）` : '选择一名在场角色')
                            }
                            className="flex-1 min-w-0 bg-black/50 border border-gray-700 rounded-lg p-2.5 text-sm text-paper-white font-serif placeholder-gray-600 outline-none focus:border-wuxia-gold resize-none disabled:opacity-50"
                        />
                        {sending && <button
                            type="button"
                            onClick={onStop}
                            className="px-3 h-[46px] shrink-0 border border-red-500/50 text-red-200 rounded-lg text-xs"
                        >
                            立即停止
                        </button>}
                        <button
                            type="button"
                            onClick={() => { void handleSend(); }}
                            disabled={!canSend}
                            className="px-4 h-[46px] shrink-0 bg-wuxia-gold text-ink-black rounded-lg font-bold text-sm hover:bg-white transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                            {sending ? '生成中' : '发送'}
                        </button>
                    </div>
                    <div className="text-[10px] text-gray-500 flex items-center justify-between gap-2">
                        <span>
                            本对话暂存 {当前对话.length} 条{场外对话.length > 当前对话.length ? ` · 全部暂存 ${场外对话.length} 条` : ''}
                            {' '}· 下次提交行动时一并注入，主回合成功后自动清空
                        </span>
                        {loading && <span className="text-amber-300/80">主回合进行中，对话暂停</span>}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default RoleChatModal;
