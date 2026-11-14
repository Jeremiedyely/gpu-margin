/**
 * App Header — dark top bar with environment badge and optional session badge.
 */

interface AppHeaderProps {
  sessionId?: string | null;
}

export function AppHeader({ sessionId }: AppHeaderProps) {
  return (
    <div className="bg-slate-800 px-6 md:px-10 py-3 flex flex-wrap items-center justify-between gap-3">
      <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-slate-900 text-amber-300 border border-slate-600">
        Demo environment
      </span>
      {sessionId && (
        <span className="text-xs text-slate-300 bg-white/[0.08] px-3 py-1 rounded-full font-mono">
          Session {sessionId}
        </span>
      )}
    </div>
  );
}
