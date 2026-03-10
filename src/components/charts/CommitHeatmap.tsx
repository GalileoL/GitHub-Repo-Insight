import { useMemo } from 'react';
import dayjs from 'dayjs';
import { ChartContainer } from '../common/ChartContainer';
import type { HeatmapData } from '../../utils/transformers';

interface CommitHeatmapProps {
  data: HeatmapData[] | undefined;
  loading: boolean;
  error: Error | null;
}

const CELL_SIZE = 12;
const CELL_GAP = 3;
const DAYS = ['', 'Mon', '', 'Wed', '', 'Fri', ''];

function getColor(count: number, max: number): string {
  if (count === 0) return '#161b22';
  const intensity = count / max;
  if (intensity < 0.25) return '#0e4429';
  if (intensity < 0.5) return '#006d32';
  if (intensity < 0.75) return '#26a641';
  return '#39d353';
}

export default function CommitHeatmap({ data, loading, error }: CommitHeatmapProps) {
  const { grid, weeks, maxCount, months } = useMemo(() => {
    if (!data || data.length === 0) return { grid: [], weeks: 0, maxCount: 0, months: [] };

    const sorted = [...data].sort((a, b) => a.date.localeCompare(b.date));
    const maxCount = Math.max(...data.map((d) => d.count), 1);
    const dataMap = new Map(sorted.map((d) => [d.date, d.count]));

    const startDate = dayjs(sorted[0].date).startOf('week');
    const endDate = dayjs(sorted[sorted.length - 1].date);
    const weeks = Math.ceil(endDate.diff(startDate, 'day') / 7) + 1;

    const grid: Array<{ x: number; y: number; date: string; count: number }> = [];
    const months: Array<{ label: string; x: number }> = [];
    let lastMonth = -1;

    for (let week = 0; week < weeks; week++) {
      for (let day = 0; day < 7; day++) {
        const currentDate = startDate.add(week * 7 + day, 'day');
        const dateStr = currentDate.format('YYYY-MM-DD');
        const count = dataMap.get(dateStr) || 0;

        grid.push({
          x: week * (CELL_SIZE + CELL_GAP),
          y: day * (CELL_SIZE + CELL_GAP),
          date: dateStr,
          count,
        });

        if (day === 0 && currentDate.month() !== lastMonth) {
          lastMonth = currentDate.month();
          months.push({
            label: currentDate.format('MMM'),
            x: week * (CELL_SIZE + CELL_GAP),
          });
        }
      }
    }

    return { grid, weeks, maxCount, months };
  }, [data]);

  return (
    <ChartContainer loading={loading} error={error} isEmpty={!data || data.length === 0} emptyMessage="No commit data" height="h-auto">
      <div className="overflow-x-auto pb-2">
        <svg
          width={weeks * (CELL_SIZE + CELL_GAP) + 40}
          height={7 * (CELL_SIZE + CELL_GAP) + 30}
        >
          {months.map((month, i) => (
            <text key={i} x={month.x + 40} y={10} className="text-[10px] fill-text-muted">{month.label}</text>
          ))}
          {DAYS.map((day, i) => (
            <text key={i} x={0} y={20 + i * (CELL_SIZE + CELL_GAP) + CELL_SIZE - 2} className="text-[10px] fill-text-muted">{day}</text>
          ))}
          {grid.map((cell) => (
            <rect
              key={cell.date}
              x={cell.x + 40}
              y={cell.y + 18}
              width={CELL_SIZE}
              height={CELL_SIZE}
              rx={2}
              fill={getColor(cell.count, maxCount)}
              className="transition-colors hover:stroke-text-muted hover:stroke-1"
            >
              <title>{`${cell.date}: ${cell.count} commits`}</title>
            </rect>
          ))}
        </svg>
        <div className="flex items-center justify-end gap-1 mt-2 text-xs text-text-muted">
          <span>Less</span>
          {['#161b22', '#0e4429', '#006d32', '#26a641', '#39d353'].map((color) => (
            <div key={color} className="h-[10px] w-[10px] rounded-sm" style={{ backgroundColor: color }} />
          ))}
          <span>More</span>
        </div>
      </div>
    </ChartContainer>
  );
}
