// src/telegram/infra/helper.ts
type HasClassName = { className?: unknown };

export function safeClassName(e: unknown): string {
  // Prefer GramJS className if present
  if (e && typeof e === 'object' && 'className' in (e as HasClassName)) {
    const cn = (e as HasClassName).className;
    if (typeof cn === 'string') return cn;
  }

  // Fallback: constructor name, fully typed
  if (e && typeof e === 'object') {
    const proto = Reflect.getPrototypeOf(e);
    const ctor = (proto as { constructor?: { name?: unknown } } | null)
      ?.constructor;
    const name = typeof ctor?.name === 'string' ? ctor.name : undefined;
    return name ?? 'Object';
  }

  // Primitives
  return typeof e;
}
