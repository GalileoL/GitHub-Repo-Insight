import { useMemo } from 'react';
import { useECharts } from '../../hooks/useECharts';
import { ChartContainer } from '../common/ChartContainer';
import { chartColors } from '../../utils/echarts-theme';
import { useThemeStore } from '../../store/theme';
import type { ContributorChartData } from '../../utils/transformers';
import type { EChartsOption } from 'echarts';

interface ContributorBarChartProps {
  data: ContributorChartData[] | undefined;
  loading: boolean;
  error: Error | null;
}

export default function ContributorBarChart({ data, loading, error }: ContributorBarChartProps) {
  const topContributors = useMemo(() => data?.slice(0, 10), [data]);
  const themeMode = useThemeStore((s) => s.mode);

  const option = useMemo<EChartsOption | null>(() => {
    if (!topContributors) return null;
    const c = chartColors();
    return {
      tooltip: {
        trigger: 'axis',
        backgroundColor: c.tooltipBg,
        borderColor: c.tooltipBorder,
        textStyle: { color: c.tooltipText },
        axisPointer: { type: 'shadow' },
      },
      grid: { left: 100, right: 30, top: 10, bottom: 30 },
      xAxis: {
        type: 'value',
        axisLine: { lineStyle: { color: c.axisLine } },
        axisLabel: { color: c.axisLabel },
        splitLine: { lineStyle: { color: c.splitLine } },
      },
      yAxis: {
        type: 'category',
        data: topContributors.map((ct) => ct.login).reverse(),
        axisLine: { lineStyle: { color: c.axisLine } },
        axisLabel: { color: c.axisLabel, fontSize: 12 },
        axisTick: { show: false },
      },
      series: [
        {
          type: 'bar',
          data: topContributors.map((ct) => ct.contributions).reverse(),
          itemStyle: {
            borderRadius: [0, 4, 4, 0],
            color: {
              type: 'linear',
              x: 0, y: 0, x2: 1, y2: 0,
              colorStops: [
                { offset: 0, color: '#58a6ff' },
                { offset: 1, color: '#39d2c0' },
              ],
            },
          },
          barWidth: '60%',
        },
      ],
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- themeMode triggers CSS var changes
  }, [topContributors, themeMode]);

  const chartRef = useECharts(option);

  return (
    <ChartContainer loading={loading} error={error} isEmpty={data?.length === 0} emptyMessage="No contributor data">
      <div ref={chartRef} className="h-full w-full" />
    </ChartContainer>
  );
}
