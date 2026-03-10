import { useMemo } from 'react';
import { useECharts } from '../../hooks/useECharts';
import { ChartContainer } from '../common/ChartContainer';
import type { ContributorChartData } from '../../utils/transformers';
import type { EChartsOption } from 'echarts';

interface ContributorBarChartProps {
  data: ContributorChartData[] | undefined;
  loading: boolean;
  error: Error | null;
}

export default function ContributorBarChart({ data, loading, error }: ContributorBarChartProps) {
  const topContributors = useMemo(() => data?.slice(0, 10), [data]);

  const option = useMemo<EChartsOption | null>(() => {
    if (!topContributors) return null;
    return {
      tooltip: {
        trigger: 'axis',
        backgroundColor: '#1c2128',
        borderColor: '#30363d',
        textStyle: { color: '#f0f6fc' },
        axisPointer: { type: 'shadow' },
      },
      grid: { left: 100, right: 30, top: 10, bottom: 30 },
      xAxis: {
        type: 'value',
        axisLine: { lineStyle: { color: '#30363d' } },
        axisLabel: { color: '#8b949e' },
        splitLine: { lineStyle: { color: '#21262d' } },
      },
      yAxis: {
        type: 'category',
        data: topContributors.map((c) => c.login).reverse(),
        axisLine: { lineStyle: { color: '#30363d' } },
        axisLabel: { color: '#8b949e', fontSize: 12 },
        axisTick: { show: false },
      },
      series: [
        {
          type: 'bar',
          data: topContributors.map((c) => c.contributions).reverse(),
          itemStyle: {
            borderRadius: [0, 4, 4, 0],
            color: {
              type: 'linear',
              x: 0, y: 0, x2: 1, y2: 0,
              colorStops: [
                { offset: 0, color: '#58a6ff' },
                { offset: 1, color: '#bc8cff' },
              ],
            },
          },
          barWidth: '60%',
        },
      ],
    };
  }, [topContributors]);

  const chartRef = useECharts(option);

  return (
    <ChartContainer loading={loading} error={error} isEmpty={data?.length === 0} emptyMessage="No contributor data">
      <div ref={chartRef} className="h-full w-full" />
    </ChartContainer>
  );
}
