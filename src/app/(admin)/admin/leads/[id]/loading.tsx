export default function Loading() {
  return (
    <div className="animate-pulse">
      <div className="mb-6 h-8 w-56 rounded bg-muted" />
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-5">
        <div className="h-80 rounded-2xl bg-muted xl:col-span-2" />
        <div className="h-80 rounded-2xl bg-muted xl:col-span-3" />
      </div>
    </div>
  );
}
