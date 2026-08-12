/**
 * Week 7 — Loading placeholders.
 * Showing shaped skeletons instead of "Loading…" keeps layout stable and makes
 * slow free-tier cold starts feel intentional rather than broken.
 */

export function SkeletonBar({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse bg-slate-200 rounded ${className}`} />;
}

export function StatCardSkeleton() {
  return (
    <div className="rounded-xl bg-slate-50 border border-slate-200 px-5 py-4 min-w-44 flex-1">
      <SkeletonBar className="h-3 w-24 mb-3" />
      <SkeletonBar className="h-7 w-32 mb-2" />
      <SkeletonBar className="h-2.5 w-20" />
    </div>
  );
}

export function ChartSkeleton({ height = 220 }: { height?: number }) {
  return (
    <div className="animate-pulse" style={{ height }}>
      <div className="flex items-end gap-2 h-full pb-6">
        {[45, 70, 55, 85, 60, 75, 50, 90, 65, 80].map((h, i) => (
          <div key={i} className="flex-1 bg-slate-200 rounded-t" style={{ height: `${h}%` }} />
        ))}
      </div>
    </div>
  );
}

export function TableSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex gap-3 items-center">
          <SkeletonBar className="h-4 w-16" />
          <SkeletonBar className="h-4 flex-1" />
          <SkeletonBar className="h-4 w-20" />
        </div>
      ))}
    </div>
  );
}
