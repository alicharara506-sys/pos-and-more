const LABEL: Record<string, string> = {
  red: 'Out / low',
  yellow: 'Reorder soon',
  green: 'In stock',
};
const DOT: Record<string, string> = {
  red: 'bg-stock-red',
  yellow: 'bg-stock-yellow',
  green: 'bg-stock-green',
};

export function StockBadge({ status }: { status: 'red' | 'yellow' | 'green' }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 px-2 py-0.5 text-xs dark:border-gray-700">
      <span className={`h-2 w-2 rounded-full ${DOT[status]}`} />
      {LABEL[status]}
    </span>
  );
}
