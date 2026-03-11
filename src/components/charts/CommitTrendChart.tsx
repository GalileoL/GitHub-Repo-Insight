import { useMemo } from 'react';
import { useECharts } from '../../hooks/useECharts';
import { ChartContainer } from '../common/ChartContainer';
import { chartColors } from '../../utils/echarts-theme';
import { useThemeStore } from '../../store/theme';
import type { CommitTrendData } from '../../utils/transformers';
import type { EChartsOption } from 'echarts';

interface CommitTrendChartProps {
  data: CommitTrendData[] | undefined;
  loading: boolean;
  error: Error | null;
}

export default function CommitTrendChart({ data, loading, error }: CommitTrendChartProps) {
  const themeMode = useThemeStore((s) => s.mode);
  const option = useMemo<EChartsOption | null>(() => {
    if (!data) return null;
    const c = chartColors();
    return {
      tooltip: {
        trigger: 'axis',
        backgroundColor: c.tooltipBg,
        borderColor: c.tooltipBorder,
        textStyle: { color: c.tooltipText },
      },
      grid: { left: 50, right: 30, top: 20, bottom: 40 },
      xAxis: {
        type: 'category',
        data: data.map((d) => d.week),
        axisLine: { lineStyle: { color: c.axisLine } },
        axisLabel: { color: c.axisLabel, rotate: 45, fontSize: 11 },
        axisTick: { lineStyle: { color: c.axisLine } },
      },
      yAxis: {
        type: 'value',
        axisLine: { lineStyle: { color: c.axisLine } },
        axisLabel: { color: c.axisLabel },
        splitLine: { lineStyle: { color: c.splitLine } },
      },
      series: [
        {
          type: 'line',
          data: data.map((d) => d.commits),
          smooth: true,
          showSymbol: false,
          lineStyle: { color: '#3fb950', width: 2 },
          areaStyle: {
            color: {
              type: 'linear',
              x: 0, y: 0, x2: 0, y2: 1,
              colorStops: [
                { offset: 0, color: 'rgba(63, 185, 80, 0.3)' },
                { offset: 1, color: 'rgba(63, 185, 80, 0.02)' },
              ],
            },
          },
        },
      ],
    };
  }, [data, themeMode]);

  const chartRef = useECharts(option);

  return (
    <ChartContainer loading={loading} error={error} isEmpty={data?.length === 0} emptyMessage="No commit data">
      <div ref={chartRef} className="h-full w-full" />
    </ChartContainer>
  );
}
