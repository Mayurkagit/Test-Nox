import React, { useState, useRef, useEffect } from 'react';
import { Terminal, Trash2, ChevronDown, ChevronUp, Copy, Check } from 'lucide-react';
import { useApplicantStore } from '../../store/useApplicantStore';
import { useAutomationStore } from '../../store/useAutomationStore';
import { detectDdaStage } from '../../utils/ddaRoutes';

export default function SidebarLogsConsole({
  logs = [],
  activeApplicant: propActiveApplicant,
  clearLogs
}) {
  const storeActiveApplicant = useApplicantStore((s) => s.activeApplicant);
  const activeApplicant = propActiveApplicant !== undefined ? propActiveApplicant : storeActiveApplicant;
  const activePan = (activeApplicant?.pan || activeApplicant?.personal?.pan || '').toUpperCase();

  // Shared minimized / folded state from useAutomationStore
  const isMinimized = useAutomationStore((s) => s.isConsoleMinimized);
  const setIsMinimized = useAutomationStore((s) => s.setIsConsoleMinimized);
  const currentUrl = useAutomationStore((s) => s.currentUrl);
  const activeStage = detectDdaStage(currentUrl);
  const isSchemesStage = activeStage.id === 'SCHEME' || (currentUrl && currentUrl.toLowerCase().includes('scheme'));

  const logsEndRef = useRef(null);
  const scrollContainerRef = useRef(null);
  const isAutoScrollEnabledRef = useRef(true);

  // Show all relevant automation, system, heartbeat, and applicant logs
  const filteredLogs = logs.filter(l => {
    if (l.source === 'Timer' || l.type === 'TIMER') return false;

    // Strict Stage Separation: Login page logs must never transfer to Schemes page
    if (isSchemesStage) {
      const src = (l.source || l.page || '').toLowerCase();
      const msg = String(l.message || l.msg || '').toLowerCase();
      if (src === 'login' || src === 'auth' || msg.includes('login form') || msg.includes('autofilled credentials')) {
        return false;
      }
    }

    const msg = String(l.message || l.msg || '');
    if (!l.pan || l.pan === 'System' || l.pan === 'Global' || l.source === 'Heartbeat' || l.page === 'Heartbeat' || msg.includes('💓') || msg.includes('Ping')) return true;
    if (activePan) {
      const cleanLPan = (l.pan || '').toUpperCase().trim();
      const cleanActive = activePan.trim();
      return cleanLPan === cleanActive || cleanActive.includes(cleanLPan) || cleanLPan.includes(cleanActive);
    }
    return true;
  });
  // Level filter. During a run you want ERROR/WARN only and you want it in one click; `issues`
  // is that view. Applied after the existing PAN / stage filtering so neither affects the other.
  const [levelFilter, setLevelFilter] = useState('all');
  const ISSUE_TYPES = ['ERROR', 'WARN'];
  const issueCount = filteredLogs.filter((l) => ISSUE_TYPES.includes(l.type)).length;

  const visibleLogs = React.useMemo(() => {
    if (levelFilter === 'issues') return filteredLogs.filter((l) => ISSUE_TYPES.includes(l.type));
    if (levelFilter === 'milestones') {
      return filteredLogs.filter(
        (l) => l.type === 'SUCCESS' || l.type === 'MILESTONE' || l.type === 'ACTION' || l.type === 'OCR'
      );
    }
    return filteredLogs;
  }, [filteredLogs, levelFilter]);

  const latestLog = filteredLogs.length > 0 ? filteredLogs[filteredLogs.length - 1] : null;

  const handleScroll = (e) => {
    const el = e.currentTarget;
    // Allow user to scroll up freely without snapback. Only auto-scroll when user is near bottom (< 40px)
    const isAtBottom = (el.scrollHeight - el.scrollTop - el.clientHeight) <= 40;
    isAutoScrollEnabledRef.current = isAtBottom;
  };

  // Auto-scroll logs to latest entry only if user is at the bottom
  useEffect(() => {
    if (!isMinimized && isAutoScrollEnabledRef.current) {
      logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [visibleLogs, isMinimized]);

  const handleClear = (e) => {
    e.stopPropagation();
    isAutoScrollEnabledRef.current = true;
    clearLogs?.();
  };

  // Copy the visible log as plain text. After a failed run the whole point is to get the log out
  // of the app and into a message or a file, which previously meant selecting 500 lines by hand.
  const [copied, setCopied] = useState(false);
  const handleCopy = async (e) => {
    e.stopPropagation();
    const text = visibleLogs
      .map((l) => `[${l.timestamp}] [${l.type}] [${l.source}]${l.pan ? ' (' + l.pan + ')' : ''} ${l.message}`)
      .join('\n');
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch (_) {}
  };

  return (
    <div className="bg-slate-950 border-t border-slate-200/90 shrink-0 flex flex-col z-10 shadow-lg overflow-hidden select-none font-mono">
      {/* 1. Logs Title Ribbon (Attached to top when unfolded; bottom of sidepanel when folded) */}
      <div 
        className={`h-8.5 px-2 @[220px]:px-3 bg-slate-900 ${!isMinimized ? 'border-b border-slate-800 shadow-xs' : ''} flex items-center justify-between transition-colors`}
      >
        <div className="flex items-center gap-1.5 @[220px]:gap-2 min-w-0 flex-1 mr-1 @[220px]:mr-2">
          <Terminal className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
          <span className="text-[10px] font-mono font-black uppercase tracking-wider text-slate-200 truncate shrink-0">
            Logs
          </span>

          {/* Minimized Live Log Preview */}
          {isMinimized && latestLog && (
            <span className="hidden @[230px]:inline-block text-[10px] text-slate-400 font-mono truncate max-w-[90px] @[280px]:max-w-[185px] pl-1 opacity-90">
              &gt; {latestLog.message}
            </span>
          )}
        </div>

        <div className="flex items-center gap-1 @[220px]:gap-1.5 shrink-0" onClick={(e) => e.stopPropagation()}>
          {/* Level filter: All / Issues / Milestones */}
          {!isMinimized && (
            <div className="flex items-center rounded-md overflow-hidden border border-slate-700 shrink-0">
              {[
                { id: 'all', label: 'ALL', title: 'Show every log line' },
                { id: 'issues', label: issueCount > 0 ? `!${issueCount}` : '!', title: 'Show only errors and warnings' },
                { id: 'milestones', label: '★', title: 'Show only milestones: actions, successes and captcha solves' }
              ].map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setLevelFilter(opt.id)}
                  title={opt.title}
                  className={`px-1 @[220px]:px-1.5 py-0.5 text-[9px] font-mono font-black transition-colors cursor-pointer ${
                    levelFilter === opt.id
                      ? opt.id === 'issues'
                        ? 'bg-rose-500 text-white'
                        : 'bg-slate-600 text-white'
                      : `text-slate-400 hover:text-white hover:bg-slate-800 ${opt.id === 'issues' && issueCount > 0 ? 'text-rose-400' : ''}`
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          )}

          <span className="text-[9px] @[220px]:text-[9.5px] font-mono text-slate-400 font-semibold mr-0.5 @[220px]:mr-1">
            {visibleLogs.length}<span className="hidden @[190px]:inline"> logs</span>
          </span>

          {visibleLogs.length > 0 && !isMinimized && (
            <button
              type="button"
              onClick={handleCopy}
              title="Copy the logs shown below to the clipboard"
              className="p-0.5 @[220px]:p-1 rounded text-slate-400 hover:text-emerald-400 hover:bg-slate-800 transition-colors cursor-pointer"
            >
              {copied ? <Check className="w-3 h-3 text-emerald-400 stroke-[3]" /> : <Copy className="w-3 h-3" />}
            </button>
          )}

          {filteredLogs.length > 0 && !isMinimized && (
            <button
              type="button"
              onClick={handleClear}
              title="Clear logs"
              className="p-0.5 @[220px]:p-1 rounded text-slate-400 hover:text-rose-400 hover:bg-slate-800 transition-colors cursor-pointer"
            >
              <Trash2 className="w-3 h-3" />
            </button>
          )}

          {/* Minimize / Expand Bar Toggle */}
          <button
            type="button"
            onClick={() => setIsMinimized((prev) => !prev)}
            title={isMinimized ? "Unfold Logs" : "Fold Logs"}
            className="p-0.5 @[220px]:p-1 rounded text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
          >
            {isMinimized ? <ChevronUp className="w-3.5 h-3.5 text-slate-400" /> : <ChevronDown className="w-3.5 h-3.5 text-slate-400" />}
          </button>
        </div>
      </div>

      {/* 2. Terminal Logs Window (Renders underneath the ribbon when unfolded) */}
      {!isMinimized && (
        <div 
          ref={scrollContainerRef}
          onScroll={handleScroll}
          className="h-56 transition-all duration-200 overflow-y-auto overscroll-contain p-2.5 space-y-1.5 font-mono text-[12px] leading-snug select-text scrollbar-thin scrollbar-thumb-slate-800 scrollbar-track-transparent animate-fade-in"
        >
          {visibleLogs.length === 0 ? (
            <div className="h-full flex items-center justify-center text-center px-3 text-slate-600 italic text-[12px] font-mono">
              {levelFilter !== 'all' && filteredLogs.length > 0 ? (
                <span>
                  <span className="text-slate-500">&gt;&nbsp;</span>
                  No {levelFilter === 'issues' ? 'errors or warnings' : 'milestones'} in {filteredLogs.length} log
                  {filteredLogs.length === 1 ? '' : 's'}.{' '}
                  <button
                    type="button"
                    onClick={() => setLevelFilter('all')}
                    className="not-italic font-black text-slate-400 hover:text-white underline cursor-pointer"
                  >
                    Show all
                  </button>
                </span>
              ) : (
                <span>
                  <span className="text-slate-500">&gt;&nbsp;</span>Live automation events across all sessions will stream here...
                </span>
              )}
            </div>
          ) : (
            visibleLogs.map((log) => {
              const isAction = log.type === 'ACTION';
              const isSuccess = log.type === 'SUCCESS';
              const isError = log.type === 'ERROR';
              const isWarn = log.type === 'WARN';

              return (
                <div key={log.id} className="flex flex-col gap-1 pb-1.5 border-b border-slate-900/80 last:border-0">
                  {/* Top Row: Timestamp, PAN Badge, Type Badge & Source */}
                  <div className="flex items-center gap-1.5 flex-wrap select-none">
                    <span className="text-slate-400 font-mono text-[10.5px] font-medium">
                      [{log.timestamp}]
                    </span>

                    {log.pan && (
                      <span className="px-1.5 py-0.2 rounded text-[10px] font-bold bg-[#faf5ff] text-[#4b2c83] border border-[#e9d5ff]">
                        {log.pan}
                      </span>
                    )}

                    <span className={`px-1.5 py-0.2 rounded text-[9.5px] font-extrabold uppercase tracking-wider ${
                      isAction ? 'bg-indigo-950 text-indigo-300 border border-indigo-800' :
                      isSuccess ? 'bg-emerald-950 text-emerald-300 border border-emerald-800' :
                      isError ? 'bg-rose-950 text-rose-300 border border-rose-800' :
                      isWarn ? 'bg-amber-950 text-amber-300 border border-amber-800' :
                      'bg-slate-900 text-slate-400 border border-slate-800'
                    }`}>
                      {log.type || 'INFO'}
                    </span>

                    {log.source && (
                      <span className="text-slate-300 font-bold text-[11px]">
                        [{log.source}]
                      </span>
                    )}
                  </div>

                  {/* Next Line: Log Description */}
                  <div className="text-slate-100 text-[12px] leading-relaxed break-words pl-0.5">
                    {log.message}
                  </div>
                </div>
              );
            })
          )}
          <div ref={logsEndRef} />
        </div>
      )}
    </div>
  );
}
