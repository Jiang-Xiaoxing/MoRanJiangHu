import React from 'react';
import GameButton from '../ui/GameButton';
import { GitHubSyncButton } from '../features/Auth/GitHubSyncButton';
import { RELEASE_INFO } from '../../data/releaseInfo';
import { checkForAppUpdate, downloadLatestApkPackage, openExternalUrl } from '../../services/appUpdate';
import { fetchOnlinePresencePublicStats, type OnlinePresencePublicStats } from '../../services/onlinePresence';
import type { RuntimeReleaseInfo } from '../../services/runtimeReleaseInfo';
import { 读取云端游玩会话 } from '../../services/cloudPlayService';
import { isNativeCapacitorEnvironment, setNativeSystemBarsHidden } from '../../utils/nativeRuntime';
import { 接口设置结构, ThemePreset } from '../../types';
import CreativeWorkshopModal from '../features/Workshop/CreativeWorkshopModal';

const WORKSHOP_PENDING_LOGIN_KEY = 'creative_workshop_pending_login';
const WORKSHOP_QUERY_PARAM = 'open';
const WORKSHOP_QUERY_VALUE = 'workshop';

const hasFullscreenElement = () => {
    const doc = document as Document & {
        webkitFullscreenElement?: Element;
        msFullscreenElement?: Element;
    };

    return !!(
        document.fullscreenElement ||
        doc.webkitFullscreenElement ||
        doc.msFullscreenElement
    );
};

const requestBrowserFullscreen = async () => {
    const doc = document as Document & {
        webkitFullscreenElement?: Element;
        webkitExitFullscreen?: () => Promise<void> | void;
        msFullscreenElement?: Element;
        msExitFullscreen?: () => Promise<void> | void;
    };

    const root = document.documentElement as HTMLElement & {
        webkitRequestFullscreen?: () => Promise<void> | void;
        msRequestFullscreen?: () => Promise<void> | void;
    };

    const isFullscreen = hasFullscreenElement();

    if (!isFullscreen) {
        const enter = root.requestFullscreen || root.webkitRequestFullscreen || root.msRequestFullscreen;
        if (enter) {
            try {
                await Promise.resolve(enter.call(root));
                await setNativeSystemBarsHidden(true);
            } catch (err: unknown) {
                console.error('进入全屏失败:', err);
            }
        }
        return;
    }

    const exit = document.exitFullscreen || doc.webkitExitFullscreen || doc.msExitFullscreen;
    if (exit) {
        try {
            await Promise.resolve(exit.call(document));
            await setNativeSystemBarsHidden(false);
        } catch (err: unknown) {
            console.error('退出全屏失败:', err);
        }
    }
};

interface Props {
    onStart: () => void;
    onLoad: () => void;
    onCloudPlay: () => void;
    onImageManager: () => void;
    onWorldbookManager: () => void;
    onNovelDecomposition: () => void;
    onRequireWorkshopLogin?: () => void;
    onSettings: () => void;
    onOpenReleaseNotes: () => void;
    currentTheme: ThemePreset;
    onThemeChange: (theme: ThemePreset) => void;
    hasSave: boolean;
    apiConfig?: 接口设置结构;
    releaseInfo?: RuntimeReleaseInfo;
}

const actionButtonStyle: React.CSSProperties = {
    fontFamily: 'var(--ui-按钮-font-family, inherit)',
    fontSize: 'var(--ui-按钮-font-size, 14px)',
    lineHeight: 'var(--ui-按钮-line-height, 1.2)'
};

const 格式化发布时间 = (value?: string): string => {
    if (!value) return '未记录';
    const normalized = value.replace('T', ' ').replace(/\+08:00$/, '');
    return normalized.length >= 16 ? normalized.slice(0, 16) : normalized;
};

const DISCORD_PROJECT_THREAD_URL = 'https://discord.com/channels/1380075940285124724/1507996890304872630';
const HOME_BACKGROUND_ASSETS = [
    '/assets/home/wuxia-bg-rain-gate.webp',
    '/assets/home/wuxia-bg-mountain-mist.webp',
    '/assets/home/wuxia-bg-snow-inn.webp'
];
const DISCORD_PROJECT_THREAD_TOOLTIP = '本项目已开独立贴，请点赞支持；反馈问题也请去这里。';

const API共享说明 = '也欢迎愿意支持项目的客户共享可用于开发测试的 API 地址和密钥。我承诺：客户提供的 API key 只会用于本项目开发，不会用于其他用途。目前我已为本项目购买三次接码，共花费 15 元，若长期完全自费可能难以为继。';

type 在线人数小时点 = {
    hour: string;
    label: string;
    count: number;
};

const 在线人数历史存储键 = 'moranjianghu.onlineHourlyHistory';

const 读取在线人数历史 = (): 在线人数小时点[] => {
    try {
        const raw = window.localStorage.getItem(在线人数历史存储键);
        const parsed = raw ? JSON.parse(raw) : [];
        if (!Array.isArray(parsed)) return [];
        return parsed
            .map((item) => ({
                hour: typeof item?.hour === 'string' ? item.hour : '',
                label: typeof item?.label === 'string' ? item.label : '',
                count: Math.max(0, Number(item?.count) || 0)
            }))
            .filter((item) => item.hour && item.label)
            .slice(-24);
    } catch {
        return [];
    }
};

const 写入在线人数小时点 = (stats: OnlinePresencePublicStats): 在线人数小时点[] => {
    const date = stats.serverTime ? new Date(stats.serverTime) : new Date();
    if (Number.isNaN(date.getTime())) return 读取在线人数历史();
    date.setMinutes(0, 0, 0);
    const hour = date.toISOString();
    const label = `${date.getHours().toString().padStart(2, '0')}:00`;
    const nextPoint: 在线人数小时点 = {
        hour,
        label,
        count: Math.max(0, Number(stats.onlineCount) || 0)
    };
    const history = 读取在线人数历史().filter((item) => item.hour !== hour);
    const next = [...history, nextPoint].sort((a, b) => a.hour.localeCompare(b.hour)).slice(-24);
    try {
        window.localStorage.setItem(在线人数历史存储键, JSON.stringify(next));
    } catch {
        // Ignore storage failures; the live counter still works.
    }
    return next;
};

const 从服务端在线历史转换 = (stats: OnlinePresencePublicStats): 在线人数小时点[] => (
    Array.isArray(stats.hourlyHistory)
        ? stats.hourlyHistory
            .map((item) => ({
                hour: typeof item.hour === 'string' ? item.hour : '',
                label: 格式化在线人数时间标签(item.hour, false),
                count: Math.max(0, Number(item.onlineCount) || 0)
            }))
            .filter((item) => item.hour)
            .sort((left, right) => left.hour.localeCompare(right.hour))
            .slice(-24)
        : []
);

const 格式化在线人数时间标签 = (hour: string, includeDate: boolean) => {
    const date = new Date(hour);
    if (Number.isNaN(date.getTime())) return '--:--';
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const day = date.getDate().toString().padStart(2, '0');
    const time = `${date.getHours().toString().padStart(2, '0')}:00`;
    return includeDate ? `${month}/${day} ${time}` : time;
};

const 格式化在线人数小时短标签 = (hour: string) => {
    const date = new Date(hour);
    return Number.isNaN(date.getTime()) ? '--' : String(date.getHours());
};

const 格式化在线人数日期标签 = (hour: string) => {
    const date = new Date(hour);
    if (Number.isNaN(date.getTime())) return '';
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const day = date.getDate().toString().padStart(2, '0');
    return `${date.getFullYear()}${month}${day}`;
};

const 在线人数折线图: React.FC<{ data: 在线人数小时点[]; current?: OnlinePresencePublicStats | null }> = ({ data, current }) => {
    const [hoveredIndex, setHoveredIndex] = React.useState<number | null>(null);
    const panelRef = React.useRef<HTMLDivElement | null>(null);
    const chartScrollRef = React.useRef<HTMLDivElement | null>(null);
    const chartFrameRef = React.useRef<HTMLDivElement | null>(null);
    const nativeTooltipRef = React.useRef<HTMLDivElement | null>(null);
    const tooltipHoldTimerRef = React.useRef<number | null>(null);
    const points = data.length > 0
        ? data
        : [{ hour: 'empty', label: '--:--', count: current?.onlineCount ?? 0 }];
    const pointDayKey = (item: 在线人数小时点) => {
        const date = new Date(item.hour);
        return Number.isNaN(date.getTime()) ? item.hour : `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
    };
    const height = 120;
    const padX = 16;
    const padY = 12;
    const chartBottom = 72;
    const hourLabelY = 90;
    const braceY = 97;
    const dateLabelY = 112;
    const baseWidth = 280;
    const minPointGap = 30;
    const width = Math.max(baseWidth, padX * 2 + Math.max(0, points.length - 1) * minPointGap);
    const maxCount = Math.max(1, ...points.map((item) => item.count));
    const pointPosition = (item: 在线人数小时点, index: number) => {
        const x = points.length <= 1
            ? width / 2
            : padX + (index / (points.length - 1)) * (width - padX * 2);
        const y = chartBottom - (item.count / maxCount) * (chartBottom - padY);
        return { x, y };
    };
    const path = points.map((item, index) => {
        const { x, y } = pointPosition(item, index);
        return `${index === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
    }).join(' ');
    const hoveredPoint = hoveredIndex !== null ? points[hoveredIndex] : null;
    const hoveredPosition = React.useMemo(
        () => hoveredPoint ? pointPosition(hoveredPoint, hoveredIndex ?? 0) : null,
        [hoveredPoint, hoveredIndex, width, maxCount]
    );
    const hoverColumnWidth = points.length <= 1
        ? Math.max(52, width - padX * 2)
        : Math.max(28, Math.min(46, (width - padX * 2) / Math.max(1, points.length - 1)));
    const dateGroups = points.reduce<Array<{ key: string; start: number; end: number; label: string }>>((groups, item, index) => {
        const key = pointDayKey(item);
        const last = groups[groups.length - 1];
        if (last && last.key === key) {
            last.end = index;
            return groups;
        }
        groups.push({ key, start: index, end: index, label: 格式化在线人数日期标签(item.hour) || item.label });
        return groups;
    }, []);

    React.useLayoutEffect(() => {
        const scrollContainer = chartScrollRef.current;
        if (!scrollContainer) return;
        scrollContainer.scrollLeft = scrollContainer.scrollWidth - scrollContainer.clientWidth;
    }, [points.length, width]);

    React.useEffect(() => {
        const tooltip = document.createElement('div');
        tooltip.className = 'landing-presence-tooltip landing-presence-native-tooltip';
        tooltip.textContent = '-- 人';
        tooltip.style.left = '28px';
        tooltip.style.top = '0px';
        tooltip.style.opacity = '0';
        tooltip.style.visibility = 'hidden';
        document.body.appendChild(tooltip);
        nativeTooltipRef.current = tooltip;

        return () => {
            if (tooltipHoldTimerRef.current !== null) {
                window.clearTimeout(tooltipHoldTimerRef.current);
                tooltipHoldTimerRef.current = null;
            }
            if (nativeTooltipRef.current === tooltip) {
                nativeTooltipRef.current = null;
            }
            tooltip.remove();
        };
    }, []);

    const showNativeTooltip = React.useCallback((index: number, pointer?: { clientX?: number; clientY?: number }) => {
        const tooltip = nativeTooltipRef.current;
        const panel = panelRef.current;
        const scrollContainer = chartScrollRef.current;
        const point = points[index];
        if (!tooltip || !panel || !scrollContainer || !point) return;
        const position = pointPosition(point, index);
        const left = typeof pointer?.clientX === 'number'
            ? pointer.clientX
            : scrollContainer.getBoundingClientRect().left + position.x - scrollContainer.scrollLeft;
        const top = typeof pointer?.clientY === 'number'
            ? pointer.clientY - 38
            : scrollContainer.getBoundingClientRect().top + position.y - 42;
        tooltip.textContent = `${point.count} 人`;
        tooltip.style.left = `${Math.max(42, Math.min(window.innerWidth - 42, left))}px`;
        tooltip.style.top = `${Math.max(8, Math.min(window.innerHeight - 34, top))}px`;
        tooltip.style.opacity = '1';
        tooltip.style.visibility = 'visible';
    }, [points, width, maxCount]);

    const hideNativeTooltip = React.useCallback(() => {
        const tooltip = nativeTooltipRef.current;
        if (!tooltip) return;
        tooltip.style.opacity = '0';
        tooltip.style.visibility = 'hidden';
    }, []);

    const 显示在线人数提示 = React.useCallback((index: number, hold = false, pointer?: { clientX?: number; clientY?: number }) => {
        if (tooltipHoldTimerRef.current !== null) {
            window.clearTimeout(tooltipHoldTimerRef.current);
            tooltipHoldTimerRef.current = null;
        }
        showNativeTooltip(index, pointer);
        setHoveredIndex(index);
        if (hold) {
            tooltipHoldTimerRef.current = window.setTimeout(() => {
                setHoveredIndex(null);
                hideNativeTooltip();
                tooltipHoldTimerRef.current = null;
            }, 2600);
        }
    }, [hideNativeTooltip, showNativeTooltip]);

    const 隐藏在线人数提示 = React.useCallback(() => {
        if (tooltipHoldTimerRef.current !== null) return;
        hideNativeTooltip();
        setHoveredIndex(null);
    }, [hideNativeTooltip]);

    const 从指针位置显示最近在线人数提示 = React.useCallback((pointer: { clientX: number; clientY: number }) => {
        const scrollContainer = chartScrollRef.current;
        const panel = panelRef.current;
        if (!scrollContainer || !panel) return false;
        const rect = scrollContainer.getBoundingClientRect();
        const panelRect = panel.getBoundingClientRect();
        const visibleLeft = Math.max(rect.left, panelRect.left, 0);
        const visibleRight = Math.min(rect.right, panelRect.right, window.innerWidth);
        const visibleTop = Math.max(panelRect.top, 0);
        const visibleBottom = Math.min(panelRect.bottom, window.innerHeight);
        const pointerNearChartX = pointer.clientX >= visibleLeft - 36 && pointer.clientX <= visibleRight + 36;
        const pointerInsideVisiblePanelY = pointer.clientY >= visibleTop - 12 && pointer.clientY <= visibleBottom + 12;
        if (!pointerNearChartX || !pointerInsideVisiblePanelY) return false;
        if (tooltipHoldTimerRef.current !== null) {
            window.clearTimeout(tooltipHoldTimerRef.current);
            tooltipHoldTimerRef.current = null;
        }
        const localX = pointer.clientX - rect.left + scrollContainer.scrollLeft;
        let nearestIndex = 0;
        let nearestDistance = Number.POSITIVE_INFINITY;
        points.forEach((item, index) => {
            const { x } = pointPosition(item, index);
            const distance = Math.abs(x - localX);
            if (distance < nearestDistance) {
                nearestDistance = distance;
                nearestIndex = index;
            }
        });
        显示在线人数提示(nearestIndex, false, pointer);
        return true;
    }, [points, width, maxCount, 显示在线人数提示]);

    const 从图表位置显示最近在线人数提示 = React.useCallback((event: React.MouseEvent<HTMLDivElement> | React.PointerEvent<HTMLDivElement>) => {
        从指针位置显示最近在线人数提示(event);
    }, [从指针位置显示最近在线人数提示]);

    React.useEffect(() => {
        const handlePointerMove = (event: PointerEvent | MouseEvent) => {
            if (!从指针位置显示最近在线人数提示(event) && tooltipHoldTimerRef.current === null) {
                隐藏在线人数提示();
            }
        };
        const handleTouchMove = (event: TouchEvent) => {
            const touch = event.touches[0];
            if (!touch) return;
            if (!从指针位置显示最近在线人数提示(touch) && tooltipHoldTimerRef.current === null) {
                隐藏在线人数提示();
            }
        };
        window.addEventListener('pointermove', handlePointerMove, { passive: true });
        window.addEventListener('mousemove', handlePointerMove, { passive: true });
        window.addEventListener('touchmove', handleTouchMove, { passive: true });
        return () => {
            window.removeEventListener('pointermove', handlePointerMove);
            window.removeEventListener('mousemove', handlePointerMove);
            window.removeEventListener('touchmove', handleTouchMove);
        };
    }, [从指针位置显示最近在线人数提示, 隐藏在线人数提示]);

    return (
        <div
            ref={panelRef}
            className="landing-presence-panel relative z-10 flex h-full w-full flex-col items-center border border-emerald-400/25 bg-emerald-500/10 px-4 py-2 text-center shadow-[0_12px_28px_rgba(0,0,0,0.3)]"
            onMouseMove={从图表位置显示最近在线人数提示}
            onPointerMove={从图表位置显示最近在线人数提示}
            onPointerLeave={隐藏在线人数提示}
        >
            <div className="landing-presence-metrics grid w-full max-w-[430px] grid-cols-3 items-start gap-3">
                <div className="landing-presence-metric">
                    <div className="landing-presence-label text-[10px] tracking-[0.2em] text-emerald-200/80">在线人数</div>
                    <div className="landing-presence-online mt-1 font-mono text-2xl font-bold text-emerald-100">{current ? current.onlineCount : '--'}</div>
                </div>
                <div className="landing-presence-metric">
                    <div className="landing-presence-label landing-presence-label--peak text-[10px] tracking-[0.16em] text-emerald-200/70">24小时峰值</div>
                    <div className="landing-presence-peak-value mt-1 font-mono text-2xl font-bold text-emerald-100">{maxCount}</div>
                </div>
                <div className="landing-presence-metric">
                    <div className="landing-presence-label landing-presence-label--recent text-[10px] tracking-[0.2em] text-sky-200/70">最近游玩</div>
                    <div className="landing-presence-recent mt-1 font-mono text-2xl font-bold text-sky-100">{current ? current.totalRecentCount : '--'}</div>
                </div>
            </div>
            <div
                ref={chartScrollRef}
                className="landing-presence-chart-scroll mt-1 w-full max-w-[430px] flex-1 overflow-x-auto overflow-y-visible"
                onPointerLeave={隐藏在线人数提示}
            >
                <div
                    ref={chartFrameRef}
                    className="landing-presence-chart-frame relative shrink-0"
                    style={{ width, height }}
                    onMouseMove={从图表位置显示最近在线人数提示}
                    onPointerMove={从图表位置显示最近在线人数提示}
                >
                    <svg
                        viewBox={`0 0 ${width} ${height}`}
                        width={width}
                        height={height}
                        className="landing-presence-chart min-h-0 shrink-0 overflow-visible"
                        role="img"
                        aria-label="每小时在线人数折线图"
                    >
                    <defs>
                        <linearGradient id="onlineLineGradient" x1="0" y1="0" x2="1" y2="0">
                            <stop offset="0%" stopColor="var(--landing-presence-line-start, #34d399)" />
                            <stop offset="100%" stopColor="var(--landing-presence-line-end, #38bdf8)" />
                        </linearGradient>
                        <linearGradient id="onlineAreaGradient" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="var(--landing-presence-area, #34d399)" stopOpacity="0.24" />
                            <stop offset="100%" stopColor="var(--landing-presence-area, #34d399)" stopOpacity="0" />
                        </linearGradient>
                    </defs>
                    {[0, 1, 2].map((line) => {
                        const y = padY + line * ((chartBottom - padY) / 2);
                        return <line key={line} x1={padX} y1={y} x2={width - padX} y2={y} stroke="var(--landing-presence-grid, rgba(255,255,255,0.08))" strokeWidth="1" />;
                    })}
                    {points.length > 1 && (
                        <path d={`${path} L ${width - padX} ${chartBottom} L ${padX} ${chartBottom} Z`} fill="url(#onlineAreaGradient)" />
                    )}
                    <path d={path} fill="none" stroke="url(#onlineLineGradient)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
                    {hoveredPoint && hoveredPosition && (
                        <g className="pointer-events-none">
                            <line
                                x1={hoveredPosition.x}
                                y1={hoveredPosition.y}
                                x2={hoveredPosition.x}
                                y2={hourLabelY - 4}
                                className="landing-presence-hover-line"
                                strokeWidth="1.2"
                                strokeDasharray="3 3"
                            />
                        </g>
                    )}
                    {points.map((item, index) => {
                        const { x, y } = pointPosition(item, index);
                        const active = hoveredIndex === index;
                        return (
                            <g key={item.hour}>
                                <circle
                                    cx={x}
                                    cy={y}
                                    r="15"
                                    fill="rgba(255,255,255,0.001)"
                                    onMouseEnter={(event) => 显示在线人数提示(index, false, event)}
                                    onMouseMove={(event) => 显示在线人数提示(index, false, event)}
                                    onPointerEnter={(event) => 显示在线人数提示(index, false, event)}
                                    onPointerMove={(event) => 显示在线人数提示(index, false, event)}
                                    onPointerDown={(event) => 显示在线人数提示(index, true, event)}
                                    onClick={() => 显示在线人数提示(index, true)}
                                    onTouchStart={() => 显示在线人数提示(index, true)}
                                    onFocus={() => 显示在线人数提示(index)}
                                    onBlur={隐藏在线人数提示}
                                    tabIndex={0}
                                    role="img"
                                    aria-label={`在线人数 ${item.count}`}
                                    title={`${item.count} 人`}
                                    className="landing-presence-hit-dot cursor-pointer"
                                />
                                {active ? (
                                    <g className="pointer-events-none">
                                        <circle
                                            cx={x}
                                            cy={y}
                                            r="7"
                                            fill="var(--landing-presence-selected-fill, transparent)"
                                            stroke="var(--landing-presence-selected-stroke, #fef3c7)"
                                            strokeWidth="2.2"
                                        />
                                        <circle
                                            cx={x}
                                            cy={y}
                                            r="2.8"
                                            fill="var(--landing-presence-selected-stroke, #fef3c7)"
                                        />
                                    </g>
                                ) : (
                                    <circle
                                        cx={x}
                                        cy={y}
                                        r={index === points.length - 1 ? 4 : 2.8}
                                        fill={index === points.length - 1 ? 'var(--landing-presence-current-dot, #fef3c7)' : 'var(--landing-presence-dot, #6ee7b7)'}
                                        className="pointer-events-none transition-all"
                                    />
                                )}
                                <text x={x} y={hourLabelY} textAnchor="middle" className="landing-presence-axis-label font-mono text-[9px]">
                                    {item.hour === 'empty' ? item.label : 格式化在线人数小时短标签(item.hour)}
                                </text>
                            </g>
                        );
                    })}
                    {dateGroups.map((group) => {
                        const start = pointPosition(points[group.start], group.start).x;
                        const end = pointPosition(points[group.end], group.end).x;
                        const left = Math.max(padX, start - 8);
                        const right = Math.min(width - padX, end + 8);
                        const center = (left + right) / 2;
                        const groupWidth = right - left;
                        return (
                            <g key={group.key} className="pointer-events-none">
                                {groupWidth >= 24 && (
                                    <path
                                        d={`M ${left.toFixed(1)} ${braceY - 4} Q ${left.toFixed(1)} ${braceY} ${(left + Math.min(center, left + 10)).toFixed(1)} ${braceY} L ${(right - Math.min(10, Math.max(0, groupWidth / 3))).toFixed(1)} ${braceY} Q ${right.toFixed(1)} ${braceY} ${right.toFixed(1)} ${braceY - 4}`}
                                        fill="none"
                                        className="landing-presence-date-brace"
                                        strokeWidth="1.1"
                                    />
                                )}
                                {groupWidth >= 52 && (
                                    <text x={center} y={dateLabelY} textAnchor="middle" className="landing-presence-axis-date font-mono text-[8px]">
                                        {group.label}
                                    </text>
                                )}
                            </g>
                        );
                    })}
                    </svg>
                    {points.map((item, index) => {
                        const { x } = pointPosition(item, index);
                        return (
                            <div
                                key={`presence-hover-column-${item.hour}-${index}`}
                                className="landing-presence-hover-column absolute top-0 z-[5] cursor-pointer bg-transparent"
                                style={{
                                    left: Math.max(0, x - hoverColumnWidth / 2),
                                    width: hoverColumnWidth,
                                    height: hourLabelY + 10
                                }}
                                role="img"
                                aria-label={`在线人数 ${item.count}`}
                                title={`${item.count} 人`}
                                tabIndex={0}
                                onPointerEnter={(event) => 显示在线人数提示(index, false, event)}
                                onPointerMove={(event) => 显示在线人数提示(index, false, event)}
                                onPointerDown={(event) => 显示在线人数提示(index, true, event)}
                                onClick={() => 显示在线人数提示(index, true)}
                                onTouchStart={() => 显示在线人数提示(index, true)}
                                onFocus={() => 显示在线人数提示(index)}
                                onBlur={隐藏在线人数提示}
                            />
                        );
                    })}
                    {points.map((item, index) => {
                        const { x, y } = pointPosition(item, index);
                        return (
                            <div
                                key={`presence-hover-point-${item.hour}-${index}`}
                                className="landing-presence-hover-point absolute z-10 cursor-pointer rounded-full bg-transparent"
                                style={{
                                    left: x - 14,
                                    top: y - 14,
                                    width: 28,
                                    height: 28
                                }}
                                role="img"
                                aria-label={`在线人数 ${item.count}`}
                                title={`${item.count} 人`}
                                tabIndex={0}
                                onMouseEnter={(event) => 显示在线人数提示(index, false, event)}
                                onMouseMove={(event) => 显示在线人数提示(index, false, event)}
                                onPointerEnter={(event) => 显示在线人数提示(index, false, event)}
                                onPointerMove={(event) => 显示在线人数提示(index, false, event)}
                                onPointerDown={(event) => 显示在线人数提示(index, true, event)}
                                onClick={() => 显示在线人数提示(index, true)}
                                onTouchStart={() => 显示在线人数提示(index, true)}
                                onFocus={() => 显示在线人数提示(index)}
                                onBlur={隐藏在线人数提示}
                            />
                        );
                    })}
                </div>
            </div>
        </div>
    );
};

const LandingPage: React.FC<Props> = ({
    onStart,
    onLoad,
    onCloudPlay,
    onImageManager,
    onWorldbookManager,
    onNovelDecomposition,
    onRequireWorkshopLogin,
    onSettings,
    onOpenReleaseNotes,
    currentTheme,
    onThemeChange,
    hasSave,
    apiConfig,
    releaseInfo = RELEASE_INFO
}) => {
    const isNativeApp = React.useMemo(() => isNativeCapacitorEnvironment(), []);
    const [isCheckingUpdate, setIsCheckingUpdate] = React.useState(false);
    const [presenceStats, setPresenceStats] = React.useState<OnlinePresencePublicStats | null>(null);
    const [presenceHistory, setPresenceHistory] = React.useState<在线人数小时点[]>([]);
    const [supportDetailsOpen, setSupportDetailsOpen] = React.useState(false);
    const [localPlayOpen, setLocalPlayOpen] = React.useState(false);
    const [workshopOpen, setWorkshopOpen] = React.useState(false);
    const [backgroundIndex, setBackgroundIndex] = React.useState(0);

    const handleOpenWorkshop = React.useCallback(async () => {
        if (isNativeApp) {
            setWorkshopOpen(true);
            return;
        }
        setWorkshopOpen(true);
    }, [isNativeApp]);

    React.useEffect(() => {
        const timer = window.setInterval(() => {
            setBackgroundIndex((current) => (current + 1) % HOME_BACKGROUND_ASSETS.length);
        }, 16000);
        return () => window.clearInterval(timer);
    }, []);

    React.useEffect(() => {
        if (typeof window === 'undefined') return;
        const url = new URL(window.location.href);
        if (url.searchParams.get(WORKSHOP_QUERY_PARAM) !== WORKSHOP_QUERY_VALUE) return;

        setWorkshopOpen(true);
        url.searchParams.delete(WORKSHOP_QUERY_PARAM);
        window.history.replaceState(window.history.state, document.title, url.toString());
    }, []);

    React.useEffect(() => {
        const timer = window.setInterval(() => {
            if (localStorage.getItem(WORKSHOP_PENDING_LOGIN_KEY) !== 'true') return;
            if (!读取云端游玩会话()) return;
            localStorage.removeItem(WORKSHOP_PENDING_LOGIN_KEY);
            void handleOpenWorkshop();
        }, 800);
        return () => window.clearInterval(timer);
    }, [handleOpenWorkshop]);

    const handleRequireWorkshopLogin = React.useCallback(() => {
        localStorage.setItem(WORKSHOP_PENDING_LOGIN_KEY, 'true');
        setWorkshopOpen(false);
        onRequireWorkshopLogin?.();
    }, [onRequireWorkshopLogin]);

    React.useEffect(() => {
        const syncSystemBars = () => {
            void setNativeSystemBarsHidden(hasFullscreenElement());
        };

        document.addEventListener('fullscreenchange', syncSystemBars);
        return () => {
            document.removeEventListener('fullscreenchange', syncSystemBars);
            void setNativeSystemBarsHidden(false);
        };
    }, []);

    React.useEffect(() => {
        setPresenceHistory(读取在线人数历史());
        let cancelled = false;
        const refresh = async () => {
            const stats = await fetchOnlinePresencePublicStats();
            if (!cancelled && stats) {
                setPresenceStats(stats);
                const serverHistory = 从服务端在线历史转换(stats);
                setPresenceHistory(serverHistory.length > 0 ? serverHistory : 写入在线人数小时点(stats));
            }
        };
        void refresh();
        const timer = window.setInterval(() => { void refresh(); }, 30000);
        return () => {
            cancelled = true;
            window.clearInterval(timer);
        };
    }, []);

    const handleCheckUpdate = async () => {
        setIsCheckingUpdate(true);
        try {
            await checkForAppUpdate();
        } catch (error: any) {
            window.alert(`开始更新失败：${error?.message || '未知错误'}`);
        } finally {
            setIsCheckingUpdate(false);
        }
    };

    const handleDownloadApk = async () => {
        setIsCheckingUpdate(true);
        try {
            await downloadLatestApkPackage();
        } catch (error: any) {
            window.alert(`下载 APK 失败：${error?.message || '未知错误'}`);
        } finally {
            setIsCheckingUpdate(false);
        }
    };

    return (
        <div className="landing-page relative z-40 flex min-h-full w-full max-w-full min-w-0 flex-col items-center rounded-xl bg-black px-4 pt-[max(var(--app-safe-top,env(safe-area-inset-top,0px)),12px)] pb-[calc(var(--app-safe-bottom,env(safe-area-inset-bottom,0px))+16px)]">
            <div className="landing-bg absolute inset-0" aria-hidden="true">
                <div
                    className="landing-bg-art absolute inset-0"
                    style={{ '--landing-bg-image': `url("${HOME_BACKGROUND_ASSETS[backgroundIndex]}")` } as React.CSSProperties}
                />
                <div className="landing-bg-ink absolute inset-0" />
                <div className="landing-bg-vignette absolute inset-0" />
                <div className="landing-bg-grid absolute inset-x-0 bottom-0" />
            </div>

            <div className="landing-topbar relative z-20 mb-3 flex w-full max-w-full min-w-0 flex-wrap items-center justify-center gap-2 pt-2 sm:max-w-6xl sm:justify-end md:mb-4">
                <button
                    type="button"
                    onClick={() => { void openExternalUrl(DISCORD_PROJECT_THREAD_URL); }}
                    className="landing-discord-thread-button landing-topbar-button min-h-[40px] border px-3 py-2 text-xs font-serif tracking-[0.16em] shadow-[0_0_18px_rgba(99,102,241,0.16)] transition-colors md:text-sm"
                    style={actionButtonStyle}
                    title={DISCORD_PROJECT_THREAD_TOOLTIP}
                    aria-label={DISCORD_PROJECT_THREAD_TOOLTIP}
                >
                    Discord 独立贴
                </button>

                <GitHubSyncButton floating={false} />

                {isNativeApp && (
                    <button
                        type="button"
                        onClick={() => { void handleCheckUpdate(); }}
                    className="landing-topbar-button min-h-[40px] border border-wuxia-gold/40 bg-black/60 px-3 py-2 text-xs font-serif tracking-[0.18em] text-wuxia-gold transition-colors hover:bg-black/80 md:text-sm"
                        style={actionButtonStyle}
                        title="检查 APK 更新"
                    >
                        {isCheckingUpdate ? '检查中...' : '检查更新'}
                    </button>
                )}

                <button
                    type="button"
                    onClick={() => onThemeChange(currentTheme === 'day' ? 'ink' : 'day')}
                    className="landing-topbar-button min-h-[40px] border border-wuxia-cyan/40 bg-black/60 px-3 py-2 text-xs font-serif tracking-[0.18em] text-wuxia-cyan transition-colors hover:bg-black/80 md:text-sm"
                    style={actionButtonStyle}
                    title={currentTheme === 'day' ? '切换到黑夜模式' : '切换到白天模式'}
                >
                    {currentTheme === 'day' ? '黑夜模式' : '白天模式'}
                </button>

                <button
                    type="button"
                    onClick={() => { void requestBrowserFullscreen(); }}
                    className="landing-topbar-button min-h-[40px] border border-wuxia-gold/40 bg-black/60 px-3 py-2 text-xs font-serif tracking-[0.2em] text-wuxia-gold transition-colors hover:bg-black/80 md:text-sm"
                    style={actionButtonStyle}
                    title="切换全屏"
                >
                    全屏
                </button>
            </div>

            <div className="landing-stage relative z-10 flex w-full max-w-full min-w-0 flex-1 flex-col items-center gap-6 overflow-visible pb-2 lg:block lg:max-w-[2200px]">
                <section className="landing-hero-section relative z-20 flex w-full max-w-full min-w-0 flex-col items-center justify-center overflow-x-hidden animate-fadeIn lg:absolute lg:left-1/2 lg:top-[40%] lg:min-h-[calc(100vh-210px)] lg:-translate-x-1/2 lg:-translate-y-1/2">
                    <div className="relative mb-7 flex w-full max-w-full min-w-0 flex-col items-center">
                        <div className="landing-title-glow absolute -top-20 left-1/2 h-64 w-[36rem] -translate-x-1/2 rounded-full bg-wuxia-gold/5 blur-3xl" />

                        <h1
                            onClick={() => { void requestBrowserFullscreen(); }}
                            className="landing-title mb-4 cursor-pointer select-none bg-gradient-to-b from-gray-100 to-gray-500 bg-clip-text text-center font-serif text-7xl font-black tracking-[0.1em] text-transparent drop-shadow-2xl md:text-9xl"
                            style={{
                                fontFamily: 'var(--ui-页面标题-font-family, inherit)',
                                fontSize: 'var(--ui-页面标题-font-size, clamp(3rem,8vw,6rem))',
                                lineHeight: 'var(--ui-页面标题-line-height, 1.2)',
                                fontStyle: 'var(--ui-页面标题-font-style, normal)'
                            }}
                            title="点击切换全屏"
                        >
                            墨色江湖
                        </h1>

                        <div
                            className="landing-version-badge mb-4 inline-flex items-center border border-white/10 bg-black/30 px-3 py-1 text-[10px] font-mono tracking-[0.3em] text-gray-400/80 backdrop-blur-md"
                            style={{
                                fontFamily: 'var(--ui-等宽信息-font-family, inherit)',
                                fontSize: 'var(--ui-等宽信息-font-size, 12px)',
                                lineHeight: 'var(--ui-等宽信息-line-height, 1.45)'
                            }}
                        >
                            VER {releaseInfo.versionName} · APK {releaseInfo.versionCode}
                        </div>

                        <div className="landing-subtitle-row flex w-full max-w-full min-w-0 items-center justify-center gap-3 opacity-90 sm:gap-6">
                            <div className="h-px w-16 bg-gradient-to-r from-transparent to-wuxia-red" />
                            <h2
                                className="text-shadow-sm text-xl font-bold uppercase tracking-[0.5em] text-wuxia-red md:text-2xl"
                                style={{
                                    fontFamily: 'var(--ui-分组标题-font-family, inherit)',
                                    lineHeight: 'var(--ui-分组标题-line-height, 1.35)'
                                }}
                            >
                                却又不止江湖
                            </h2>
                            <div className="h-px w-16 bg-gradient-to-l from-transparent to-wuxia-red" />
                        </div>

                        <div className="landing-edition-card mt-7 w-full max-w-full border-2 border-amber-400/70 bg-amber-950/35 px-4 py-4 text-center shadow-[0_0_28px_rgba(251,191,36,0.16)] sm:max-w-2xl">
                            <div className="landing-edition-kicker text-sm font-bold tracking-[0.24em] text-amber-200 md:text-base">
                                bacon159 二创版本
                            </div>
                            <div className="mt-2 text-xs leading-6 text-amber-50/90 md:text-sm">
                                本版本的部分功能、设置项和本地数据结构可能与原版或其他二创版本不同，跨版本导入存档/设置前请务必备份；不同版本之间可能不兼容。
                            </div>
                            <div className="mt-3 border-t border-amber-300/25 pt-3 text-xs leading-6 text-amber-100/90 md:text-sm">
                                共创者：Ling、NullUserSIe、( ఠൠఠ )、倒挂的梦、Jiang-Xiaoxing
                            </div>
                        </div>
                    </div>

                    <div className="landing-action-group flex w-[min(16rem,calc(100vw-2rem))] max-w-full flex-col gap-3 animate-slide-in delay-100">
                        <GameButton onClick={() => setLocalPlayOpen(true)} variant="primary" className="py-4 text-lg shadow-lg">
                            本地游玩
                        </GameButton>

                        <GameButton onClick={onCloudPlay} variant="secondary" className="border-opacity-50 py-4 text-lg opacity-95 shadow-lg hover:opacity-100">
                            云端游玩
                        </GameButton>

                        <GameButton onClick={() => { void handleOpenWorkshop(); }} variant="secondary" className="border-opacity-50 py-4 text-lg opacity-95 shadow-lg hover:opacity-100">
                            创意工坊
                        </GameButton>

                        <GameButton onClick={onImageManager} variant="secondary" className="border-opacity-50 py-4 text-lg opacity-90 shadow-lg hover:opacity-100">
                            图片管理
                        </GameButton>

                        <GameButton onClick={onWorldbookManager} variant="secondary" className="border-opacity-50 py-4 text-lg opacity-90 shadow-lg hover:opacity-100">
                            世界书管理
                        </GameButton>

                        <GameButton onClick={onSettings} variant="secondary" className="border-opacity-50 py-4 text-lg opacity-80 shadow-lg hover:opacity-100">
                            设置
                        </GameButton>
                    </div>
                </section>

                <div className="landing-dashboard-row relative z-10 grid w-full max-w-full min-w-0 grid-cols-1 items-stretch gap-4 overflow-visible animate-fadeIn lg:absolute lg:bottom-16 lg:left-1/2 lg:h-[224px] lg:max-h-[224px] lg:max-w-[1020px] lg:-translate-x-1/2 lg:grid-cols-[minmax(300px,400px)_minmax(420px,1fr)] lg:overflow-visible">
                    <aside className="landing-card landing-release-card flex min-h-0 min-w-0 flex-col overflow-hidden rounded-2xl border border-wuxia-gold/15 bg-black/45 px-4 py-3 shadow-[0_12px_36px_rgba(0,0,0,0.45)] backdrop-blur-sm">
                        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-wuxia-gold/10 pb-2">
                            <div>
                                <div className="text-sm font-serif tracking-[0.24em] text-wuxia-gold">发布信息</div>
                                <div className="mt-1 text-xs text-gray-400">
                                    Web / APK 当前统一版本 v{releaseInfo.versionName}
                                </div>
                                <div className="mt-1 text-[11px] font-mono tracking-[0.08em] text-gray-500">
                                    发布时间 {格式化发布时间(releaseInfo.releasePublishedAt)}
                                </div>
                            </div>
                            <div className="text-xs font-mono tracking-[0.18em] text-gray-500">
                                APK CODE {releaseInfo.versionCode}
                            </div>
                        </div>

                        <div className="landing-release-actions mt-2 grid min-h-0 flex-1 grid-cols-2 gap-2 overflow-y-auto pr-1 sm:grid-cols-3">
                            <button
                                type="button"
                                onClick={() => { void openExternalUrl(RELEASE_INFO.githubRepoUrl); }}
                                className="min-h-[38px] border border-wuxia-gold/25 bg-white/[0.03] px-3 py-2 text-xs tracking-[0.16em] text-wuxia-gold transition-colors hover:bg-white/[0.06]"
                            >
                                GitHub 项目
                            </button>
                            <button
                                type="button"
                                onClick={() => {
                                    void handleDownloadApk();
                                }}
                                className="min-h-[38px] border border-emerald-500/25 bg-emerald-500/10 px-3 py-2 text-xs tracking-[0.16em] text-emerald-300 transition-colors hover:bg-emerald-500/15"
                            >
                                {isNativeApp ? (isCheckingUpdate ? '准备中...' : '下载 APK') : 'APK 下载'}
                            </button>
                            <button
                                type="button"
                                onClick={() => { void openExternalUrl(RELEASE_INFO.releaseNotesUrl); }}
                                className="min-h-[38px] border border-sky-500/25 bg-sky-500/10 px-3 py-2 text-xs tracking-[0.16em] text-sky-200 transition-colors hover:bg-sky-500/15"
                            >
                                更新日志
                            </button>
                            <button
                                type="button"
                                onClick={() => { void openExternalUrl((RELEASE_INFO as any).tutorialsUrl || '/tutorials.html'); }}
                                className="min-h-[38px] border border-wuxia-gold/25 bg-wuxia-gold/10 px-3 py-2 text-xs tracking-[0.16em] text-wuxia-gold transition-colors hover:bg-wuxia-gold/15"
                            >
                                教程中心
                            </button>
                            <button
                                type="button"
                                onClick={() => { void openExternalUrl('/online-ranking.html'); }}
                                className="min-h-[38px] border border-amber-400/25 bg-amber-500/10 px-3 py-2 text-xs tracking-[0.16em] text-amber-200 transition-colors hover:bg-amber-500/16"
                            >
                                在线时长榜
                            </button>
                            <button
                                type="button"
                                onClick={() => { void openExternalUrl('/item-preset-feedback.html'); }}
                                className="min-h-[38px] border border-fuchsia-500/25 bg-fuchsia-500/10 px-3 py-2 text-xs tracking-[0.16em] text-fuchsia-200 transition-colors hover:bg-fuchsia-500/15"
                            >
                                预设图反馈
                            </button>
                        </div>
                    </aside>

                    <div className="flex min-h-0 min-w-0 flex-col overflow-hidden">
                        <在线人数折线图 data={presenceHistory} current={presenceStats} />
                    </div>

                </div>
            </div>

            <div className="landing-friend-links relative z-10 mt-1 w-full max-w-full min-w-0 overflow-x-hidden border-t border-white/10 pt-1.5 sm:max-w-6xl lg:absolute lg:bottom-3 lg:left-1/2 lg:h-[38px] lg:-translate-x-1/2">
                <div className="flex h-full flex-wrap items-center justify-center gap-2 overflow-visible">
                    <button
                        type="button"
                        onClick={() => setSupportDetailsOpen(true)}
                        className="landing-support-link inline-flex h-[28px] items-center border border-amber-400/25 bg-amber-500/10 px-3 text-xs font-bold tracking-[0.12em] text-amber-100 transition-colors hover:border-amber-300/45 hover:bg-amber-500/18"
                        title="查看 API 共享支持说明"
                    >
                        API 共享说明
                    </button>
                </div>
            </div>

            {supportDetailsOpen && (
                <div className="fixed inset-0 z-[420] flex items-center justify-center bg-black/75 px-4 py-6 backdrop-blur-sm animate-fadeIn" onClick={() => setSupportDetailsOpen(false)}>
                    <div
                        className="landing-support-modal max-h-[88vh] w-full max-w-3xl overflow-y-auto rounded-2xl border border-amber-400/25 bg-[linear-gradient(180deg,rgba(25,18,8,0.98),rgba(6,6,6,0.98))] p-5 shadow-[0_26px_90px_rgba(0,0,0,0.65)] md:p-6"
                        onClick={(event) => event.stopPropagation()}
                    >
                        <div className="flex items-start justify-between gap-4">
                            <div>
                                <div className="text-lg font-serif font-bold tracking-[0.16em] text-amber-200">
                                    API 共享支持
                                </div>
                                <div className="mt-2 text-sm leading-6 text-amber-50/78">
                                    首页已撤下所有第三方站点入口，不再展示或推荐相关服务。
                                </div>
                                <div className="mt-2 text-sm leading-6 text-amber-50/78">
                                    {API共享说明}
                                </div>
                            </div>
                            <button
                                type="button"
                                onClick={() => setSupportDetailsOpen(false)}
                                className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-amber-300/25 bg-black/30 text-xl text-amber-100 transition-colors hover:border-amber-300/50 hover:text-white"
                                aria-label="关闭 API 共享说明"
                                title="关闭"
                            >
                                ×
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {localPlayOpen && (
                <div className="fixed inset-0 z-[430] flex items-center justify-center bg-black/75 px-4 py-6 backdrop-blur-sm animate-fadeIn" onClick={() => setLocalPlayOpen(false)}>
                    <div
                        className="w-full max-w-md rounded-2xl border border-wuxia-gold/25 bg-[linear-gradient(180deg,rgba(28,20,10,0.98),rgba(6,6,6,0.98))] p-5 shadow-[0_26px_90px_rgba(0,0,0,0.65)]"
                        onClick={(event) => event.stopPropagation()}
                    >
                        <div className="mb-4 flex items-start justify-between gap-4">
                            <div>
                                <div className="text-lg font-serif font-bold tracking-[0.18em] text-wuxia-gold">
                                    本地游玩
                                </div>
                                <div className="mt-2 text-sm leading-6 text-amber-50/75">
                                    选择新开一段江湖，或读取本机已有存档继续游玩。
                                </div>
                            </div>
                            <button
                                type="button"
                                onClick={() => setLocalPlayOpen(false)}
                                className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-amber-300/25 bg-black/30 text-xl text-amber-100 transition-colors hover:border-amber-300/50 hover:text-white"
                                aria-label="关闭本地游玩选择"
                                title="关闭"
                            >
                                ×
                            </button>
                        </div>

                        <div className="grid gap-3">
                            <GameButton
                                onClick={() => {
                                    setLocalPlayOpen(false);
                                    onStart();
                                }}
                                variant="primary"
                                className="py-4 text-lg shadow-lg"
                            >
                                踏入江湖
                            </GameButton>
                            <GameButton
                                onClick={() => {
                                    if (!hasSave) return;
                                    setLocalPlayOpen(false);
                                    onLoad();
                                }}
                                variant="secondary"
                                className={`py-4 text-lg shadow-lg ${!hasSave ? 'cursor-not-allowed grayscale opacity-50' : ''}`}
                                disabled={!hasSave}
                            >
                                重入江湖
                            </GameButton>
                        </div>
                    </div>
                </div>
            )}

            <CreativeWorkshopModal
                open={workshopOpen}
                onClose={() => setWorkshopOpen(false)}
                onNovelDecomposition={onNovelDecomposition}
                onRequireLogin={handleRequireWorkshopLogin}
                apiConfig={apiConfig}
            />
        </div>
    );
};

export default LandingPage;
