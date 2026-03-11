import dayjs from 'dayjs';
import type {
  GitHubLanguages,
  GitHubContributor,
  GitHubCommitActivity,
  GitHubIssue,
  GitHubRelease,
} from '../types/github';

export interface LanguageChartData {
  name: string;
  value: number;
  percentage: number;
  color: string;
}

export interface ContributorChartData {
  login: string;
  avatar_url: string;
  contributions: number;
}

export interface CommitTrendData {
  week: string;
  commits: number;
}

export interface IssuePrTrendData {
  date: string;
  issues: number;
  pullRequests: number;
}

export interface ReleaseTimelineData {
  tag: string;
  name: string;
  date: string;
  url: string;
  prerelease: boolean;
}

export interface HeatmapData {
  date: string;
  count: number;
}

const LANGUAGE_COLORS: Record<string, string> = {
  JavaScript: '#f1e05a',
  TypeScript: '#3178c6',
  Python: '#3572A5',
  Java: '#b07219',
  Go: '#00ADD8',
  Rust: '#dea584',
  Ruby: '#701516',
  PHP: '#4F5D95',
  'C++': '#f34b7d',
  C: '#555555',
  'C#': '#239120',
  Swift: '#F05138',
  Kotlin: '#A97BFF',
  Dart: '#00B4AB',
  Shell: '#89e051',
  HTML: '#e34c26',
  CSS: '#563d7c',
  Scala: '#c22d40',
  Vue: '#41b883',
  Svelte: '#ff3e00',
  Other: '#8b949e',
};

function getLanguageColor(language: string): string {
  return LANGUAGE_COLORS[language] || LANGUAGE_COLORS['Other'];
}

export function transformLanguages(data: GitHubLanguages): LanguageChartData[] {
  const total = Object.values(data).reduce((sum, bytes) => sum + bytes, 0);
  if (total === 0) return [];

  const sorted = Object.entries(data).sort(([, a], [, b]) => b - a);
  const top = sorted.slice(0, 6);
  const rest = sorted.slice(6);

  const result: LanguageChartData[] = top.map(([name, bytes]) => ({
    name,
    value: bytes,
    percentage: Math.round((bytes / total) * 1000) / 10,
    color: getLanguageColor(name),
  }));

  if (rest.length > 0) {
    const otherBytes = rest.reduce((sum, [, bytes]) => sum + bytes, 0);
    result.push({
      name: 'Other',
      value: otherBytes,
      percentage: Math.round((otherBytes / total) * 1000) / 10,
      color: getLanguageColor('Other'),
    });
  }

  return result;
}

export function transformContributors(data: GitHubContributor[]): ContributorChartData[] {
  if (!Array.isArray(data)) return [];
  return data.slice(0, 20).map(({ login, avatar_url, contributions }) => ({
    login,
    avatar_url,
    contributions,
  }));
}

export function transformCommitActivity(data: GitHubCommitActivity[]): CommitTrendData[] {
  if (!Array.isArray(data)) return [];
  return data.map((week) => ({
    week: dayjs.unix(week.week).format('MMM DD'),
    commits: week.total,
  }));
}

export function transformIssuesAndPrs(issues: GitHubIssue[]): IssuePrTrendData[] {
  if (!Array.isArray(issues) || issues.length === 0) return [];
  const grouped: Record<string, { issues: number; pullRequests: number }> = {};

  issues.forEach((issue) => {
    const month = dayjs(issue.created_at).format('YYYY-MM');
    if (!grouped[month]) grouped[month] = { issues: 0, pullRequests: 0 };
    if (issue.pull_request) {
      grouped[month].pullRequests++;
    } else {
      grouped[month].issues++;
    }
  });

  const months = Object.keys(grouped).sort();
  const start = dayjs(months[0]);
  const end = dayjs(months[months.length - 1]);
  const result: IssuePrTrendData[] = [];

  let current = start;
  while (current.isBefore(end) || current.isSame(end, 'month')) {
    const key = current.format('YYYY-MM');
    const counts = grouped[key] || { issues: 0, pullRequests: 0 };
    result.push({
      date: current.format('MMM YYYY'),
      ...counts,
    });
    current = current.add(1, 'month');
  }

  return result;
}

export function transformReleases(data: GitHubRelease[]): ReleaseTimelineData[] {
  if (!Array.isArray(data)) return [];
  return data
    .filter((r) => r.published_at)
    .sort((a, b) => dayjs(b.published_at).unix() - dayjs(a.published_at).unix())
    .map((release) => ({
      tag: release.tag_name,
      name: release.name || release.tag_name,
      date: dayjs(release.published_at).format('MMM DD, YYYY'),
      url: release.html_url,
      prerelease: release.prerelease,
    }));
}

export function transformCommitHeatmap(data: GitHubCommitActivity[]): HeatmapData[] {
  if (!Array.isArray(data)) return [];
  const result: HeatmapData[] = [];

  data.forEach((week) => {
    const startDate = dayjs.unix(week.week);
    week.days.forEach((count, dayIndex) => {
      result.push({
        date: startDate.add(dayIndex, 'day').format('YYYY-MM-DD'),
        count,
      });
    });
  });

  return result;
}
