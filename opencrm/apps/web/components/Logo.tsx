"use client";

export function LogoMark({ size = 32 }: { size?: number }) {
  return (
    <div
      className="grid place-items-center rounded-xl font-bold text-white"
      style={{
        width: size, height: size, fontSize: size * 0.52,
        background: "linear-gradient(135deg, #7c6cff, #5a4bd6)",
        boxShadow: "0 4px 16px rgba(124,108,255,0.35)",
      }}
    >
      {"\u25C8"}
    </div>
  );
}

export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <LogoMark size={compact ? 28 : 32} />
      <div>
        <div className="text-sm font-bold leading-tight tracking-tight">OpenCRM</div>
        {!compact && <div className="text-[10px] leading-tight text-ink-400">AI Website Builder</div>}
      </div>
    </div>
  );
}
