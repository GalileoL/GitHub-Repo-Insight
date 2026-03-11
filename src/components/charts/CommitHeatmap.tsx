import { useMemo } from 'react';
import dayjs from 'dayjs';
import { ChartContainer } from '../common/ChartContainer';
import { heatmapColors } from '../../utils/echarts-theme';
import { useThemeStore } from '../../store/theme';
import type { HeatmapData } from '../../utils/transformers';

interface CommitHeatmapProps {
  data: HeatmapData[] | undefined;
  loading: boolean;
  error: Error | null;
}

const CELL_SIZE = 12;
const CELL_GAP = 3;
const DAYS = ['', 'Mon', '', 'Wed', '', 'Fri', ''];

function getColor(count: number, max: number, colors: ReturnType<typeof heatmapColors>): string {
  if (count === 0) return colors.empty;
  const intensity = count / max;
  if (intensity < 0.25) return colors.l1;
  if (intensity < 0.5) return colors.l2;
  if (intensity < 0.75) return colors.l3;
  return colors.l4;
}

function getDaySuffix(day: number): string {
  if (day >= 11 && day <= 13) return 'th';
  switch (day % 10) {
    case 1: return 'st';
    case 2: return 'nd';
    case 3: return 'rd';
    default: return 'th';
  }
}

export default function CommitHeatmap({ data, loading, error }: CommitHeatmapProps) {
  const themeMode = useThemeStore((s) => s.mode);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- themeMode triggers CSS var changes
  const colors = useMemo(() => heatmapColors(), [themeMode]);

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

  const legendColors = [colors.empty, colors.l1, colors.l2, colors.l3, colors.l4];

  return (
    <ChartContainer loading={loading} error={error} isEmpty={!data || data.length === 0} emptyMessage="No commit data" height="h-auto">
      <div className="overflow-x-auto pb-2 flex flex-col items-center">
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
              fill={getColor(cell.count, maxCount, colors)}
              stroke={colors.stroke}
              strokeWidth={0.5}
              className="transition-colors hover:stroke-text-muted hover:stroke-1"
            >
              <title>{`${cell.count} ${cell.count === 1 ? 'contribution' : 'contributions'} on ${dayjs(cell.date).format('MMMM D')}${getDaySuffix(dayjs(cell.date).date())}.`}</title>
            </rect>
          ))}
        </svg>
        <div className="flex items-center justify-end gap-1 mt-2 text-xs text-text-muted">
          <span>Less</span>
          {legendColors.map((color) => (
            <div key={color} className="h-[10px] w-[10px] rounded-sm" style={{ backgroundColor: color, outline: `1px solid ${colors.stroke}` }} />
          ))}
          <span>More</span>
        </div>
      </div>
    </ChartContainer>
  );
}
