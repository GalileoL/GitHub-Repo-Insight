import { useRef, useEffect, useCallback } from 'react';
import * as echarts from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';
import { PieChart, BarChart, LineChart } from 'echarts/charts';
import {
  TitleComponent,
  TooltipComponent,
  LegendComponent,
  GridComponent,
} from 'echarts/components';
import type { EChartsOption } from 'echarts';

echarts.use([
  CanvasRenderer,
  PieChart,
  BarChart,
  LineChart,
  TitleComponent,
  TooltipComponent,
  LegendComponent,
  GridComponent,
]);

/**
 * A hook that manages an ECharts instance using a callback ref.
 *
 * This avoids a race condition where the container div is not in the DOM
 * when the component first mounts (e.g. ChartContainer shows a loading
 * skeleton instead of children).  A callback ref fires exactly when the
 * element enters or leaves the DOM, so the chart is always initialized at
 * the right time.
 */
export function useECharts(option: EChartsOption | null) {
  const chartRef = useRef<echarts.ECharts | null>(null);
  const observerRef = useRef<ResizeObserver | null>(null);
  const resizeTimerRef = useRef<number | null>(null);
  const setOptionTimerRef = useRef<number | null>(null);
  // Keep a mutable ref to the latest option so the callback ref can apply
  // it immediately when the container appears.
  const optionRef = useRef<EChartsOption | null>(option);
  useEffect(() => { optionRef.current = option; });

  const clearResizeTimer = useCallback(() => {
    if (resizeTimerRef.current !== null) {
      window.clearTimeout(resizeTimerRef.current);
      resizeTimerRef.current = null;
    }
  }, []);

  const clearSetOptionTimer = useCallback(() => {
    if (setOptionTimerRef.current !== null) {
      window.clearTimeout(setOptionTimerRef.current);
      setOptionTimerRef.current = null;
    }
  }, []);

  const scheduleResize = useCallback(() => {
    clearResizeTimer();
    resizeTimerRef.current = window.setTimeout(() => {
      chartRef.current?.resize();
    }, 200);
  }, [clearResizeTimer]);

  const scheduleSetOption = useCallback((nextOption: EChartsOption) => {
    clearSetOptionTimer();
    setOptionTimerRef.current = window.setTimeout(() => {
      chartRef.current?.setOption(nextOption, true);
    }, 200);
  }, [clearSetOptionTimer]);

  /**
   * Callback ref — called by React when the <div> mounts (node != null)
   * or unmounts (node == null).
   */
  const setContainerRef = useCallback((node: HTMLDivElement | null) => {
    // Cleanup any previous instance
    if (observerRef.current) {
      observerRef.current.disconnect();
      observerRef.current = null;
    }
    clearResizeTimer();
    clearSetOptionTimer();
    if (chartRef.current) {
      chartRef.current.dispose();
      chartRef.current = null;
    }

    if (node) {
      chartRef.current = echarts.init(node, undefined, { renderer: 'canvas' });

      // Apply the current option immediately if available
      if (optionRef.current) {
        scheduleSetOption(optionRef.current);
      }

      observerRef.current = new ResizeObserver(() => {
        scheduleResize();
      });
      observerRef.current.observe(node);
    }
  }, [clearResizeTimer, clearSetOptionTimer, scheduleResize, scheduleSetOption]);

  // Update the chart whenever the option object changes
  useEffect(() => {
    if (chartRef.current && option) {
      scheduleSetOption(option);
    }
  }, [option, scheduleSetOption]);

  // Safety-net cleanup on unmount
  useEffect(() => {
    return () => {
      observerRef.current?.disconnect();
      observerRef.current = null;
      clearResizeTimer();
      clearSetOptionTimer();
      chartRef.current?.dispose();
      chartRef.current = null;
    };
  }, [clearResizeTimer, clearSetOptionTimer]);

  return setContainerRef;
}
