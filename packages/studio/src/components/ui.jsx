"use client";

import { useEffect } from "react";

export function cx(...classes) {
  return classes.filter(Boolean).join(" ");
}

export function Button({ variant = "secondary", size = "md", className, ...props }) {
  const variants = {
    primary: "bg-primary text-black hover:bg-primary-hover shadow-glow disabled:shadow-none",
    secondary: "bg-white/[0.06] text-white hover:bg-white/[0.12] border border-white/10",
    ghost: "text-secondary hover:text-white hover:bg-white/[0.06]",
    danger: "bg-red-500/10 text-red-300 hover:bg-red-500/20 border border-red-500/20",
  };
  const sizes = {
    sm: "h-8 px-3 text-xs rounded-lg",
    md: "h-10 px-4 text-sm rounded-xl",
    lg: "h-12 px-5 text-sm rounded-xl",
  };
  return (
    <button
      type="button"
      className={cx(
        "inline-flex items-center justify-center gap-2 font-semibold transition disabled:cursor-not-allowed disabled:opacity-40",
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    />
  );
}

export function Label({ children, hint }) {
  return (
    <div className="mb-1.5 flex items-baseline justify-between gap-2">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-secondary">{children}</span>
      {hint && <span className="text-[11px] text-muted">{hint}</span>}
    </div>
  );
}

export function Field({ label, hint, children, className }) {
  return (
    <div className={className}>
      {label && <Label hint={hint}>{label}</Label>}
      {children}
    </div>
  );
}

export function Select({ value, onChange, options, className, ...props }) {
  return (
    <select
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value)}
      className={cx(
        "h-10 w-full rounded-xl border border-white/10 bg-black/40 px-3 text-sm text-white outline-none focus:border-primary",
        className,
      )}
      {...props}
    >
      {options.map((opt) => (
        <option key={opt.value} value={opt.value} className="bg-neutral-900">
          {opt.label}
        </option>
      ))}
    </select>
  );
}

export function TextArea({ className, ...props }) {
  return (
    <textarea
      className={cx(
        "w-full resize-y rounded-xl border border-white/10 bg-black/40 px-3 py-2.5 text-sm leading-relaxed text-white outline-none placeholder:text-muted focus:border-primary",
        className,
      )}
      {...props}
    />
  );
}

export function TextInput({ className, ...props }) {
  return (
    <input
      className={cx(
        "h-10 w-full rounded-xl border border-white/10 bg-black/40 px-3 text-sm text-white outline-none placeholder:text-muted focus:border-primary",
        className,
      )}
      {...props}
    />
  );
}

export function Segmented({ value, onChange, options }) {
  return (
    <div className="flex flex-wrap gap-1 rounded-xl border border-white/10 bg-black/40 p-1">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          disabled={opt.disabled}
          className={cx(
            "min-w-[3rem] flex-1 rounded-lg px-2 py-1.5 text-xs font-semibold transition disabled:opacity-30",
            value === opt.value ? "bg-white/15 text-white" : "text-secondary hover:text-white",
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

export function Toggle({ checked, onChange, label }) {
  return (
    <label className="flex cursor-pointer select-none items-center gap-2 text-sm text-white/80">
      <span
        className={cx("relative h-5 w-9 rounded-full transition", checked ? "bg-primary" : "bg-white/15")}
        onClick={() => onChange(!checked)}
      >
        <span className={cx("absolute top-0.5 h-4 w-4 rounded-full bg-white transition", checked ? "left-[18px]" : "left-0.5")} />
      </span>
      <span onClick={() => onChange(!checked)}>{label}</span>
    </label>
  );
}

export function Spinner({ className }) {
  return <span className={cx("inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent", className)} />;
}

export function Panel({ className, children }) {
  return <div className={cx("rounded-2xl border border-white/[0.07] bg-panel-bg", className)}>{children}</div>;
}

export function Modal({ open, onClose, title, children, wide = false }) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => e.key === "Escape" && onClose?.();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm" onMouseDown={onClose}>
      <div
        className={cx("flex max-h-[90vh] w-full flex-col overflow-hidden rounded-2xl border border-white/10 bg-panel-bg shadow-3xl", wide ? "max-w-5xl" : "max-w-xl")}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-white/[0.07] px-5 py-3">
          <h2 className="text-sm font-semibold text-white">{title}</h2>
          <button type="button" onClick={onClose} className="text-xl leading-none text-secondary hover:text-white" aria-label="Close">
            ×
          </button>
        </div>
        <div className="custom-scrollbar overflow-y-auto p-5">{children}</div>
      </div>
    </div>
  );
}

export function Thumb({ asset, className, onRemove, badge }) {
  if (!asset) return null;
  return (
    <div className={cx("group relative overflow-hidden rounded-lg border border-white/10 bg-black/40", className)}>
      {asset.kind === "video" ? (
        <video src={asset.url} className="h-full w-full object-cover" muted playsInline />
      ) : (
        <img src={asset.url} alt="" className="h-full w-full object-cover" loading="lazy" />
      )}
      {badge && <span className="absolute left-1 top-1 rounded bg-black/70 px-1 text-[10px] font-semibold text-white">{badge}</span>}
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          className="absolute right-1 top-1 hidden h-5 w-5 items-center justify-center rounded-full bg-black/80 text-xs text-white group-hover:flex"
          aria-label="Remove"
        >
          ×
        </button>
      )}
    </div>
  );
}

export function ErrorNote({ children }) {
  if (!children) return null;
  return <p className="rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-300">{children}</p>;
}
