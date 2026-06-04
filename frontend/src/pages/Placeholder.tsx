// Stub pages for nav targets built in later phases (2-6).
export default function Placeholder({
  title,
  phase,
}: {
  title: string;
  phase: number;
}) {
  return (
    <div>
      <h1 className="mb-2 text-2xl font-semibold">{title}</h1>
      <p className="text-sm text-slate-500">Coming in Phase {phase}.</p>
    </div>
  );
}
