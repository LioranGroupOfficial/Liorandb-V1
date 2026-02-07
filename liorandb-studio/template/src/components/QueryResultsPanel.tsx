'use client';

import React, { useState, useMemo } from 'react';
import { ChevronDown, ChevronRight, Copy, Download } from 'lucide-react';
import { useThemeStore } from '@/store/theme';
import { Query } from '@/types';

interface QueryResultsPanelProps {
  query: Query;
}

export function QueryResultsPanel({ query }: QueryResultsPanelProps) {
  const { theme } = useThemeStore();
  const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set());
  const [viewMode, setViewMode] = useState<'table' | 'json'>('table');

  const toggleRowExpanded = (index: number) => {
    const newExpanded = new Set(expandedRows);
    if (newExpanded.has(index)) {
      newExpanded.delete(index);
    } else {
      newExpanded.add(index);
    }
    setExpandedRows(newExpanded);
  };

  const resultData = useMemo(() => {
    return query.results?.data || [];
  }, [query.results]);

  const handleCopyJson = () => {
    const json = JSON.stringify(resultData, null, 2);
    navigator.clipboard.writeText(json);
  };

  const handleDownloadJson = () => {
    const json = JSON.stringify(resultData, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${query.name}-results.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  if (!query.results) {
    return (
      <div className="w-full h-full flex items-center justify-center text-slate-600 dark:text-slate-400 bg-white dark:bg-slate-950">
        <div className="text-center space-y-2">
          <div className="text-4xl">⏳</div>
          <p className="text-sm">No results yet</p>
          <p className="text-xs text-slate-500">Execute a query to see results</p>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full h-full flex flex-col bg-white dark:bg-slate-950">
      {/* Header */}
      <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-50">Results</h3>
          <span className="text-xs px-2 py-1 rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300">
            {query.results.count} documents
          </span>
          {query.results.executionTime && (
            <span className="text-xs text-slate-600 dark:text-slate-400">
              {query.results.executionTime}ms
            </span>
          )}
        </div>

        {/* View Controls */}
        <div className="flex items-center gap-2">
          <div className="flex gap-1">
            <button
              onClick={() => setViewMode('table')}
              className={`px-3 py-1 textsm rounded transition ${
                viewMode === 'table'
                  ? 'bg-blue-600 text-white'
                  : 'bg-slate-200 dark:bg-slate-800 text-slate-900 dark:text-slate-50 hover:bg-slate-300 dark:hover:bg-slate-700'
              }`}
            >
              Table
            </button>
            <button
              onClick={() => setViewMode('json')}
              className={`px-3 py-1 text-sm rounded transition ${
                viewMode === 'json'
                  ? 'bg-blue-600 text-white'
                  : 'bg-slate-200 dark:bg-slate-800 text-slate-900 dark:text-slate-50 hover:bg-slate-300 dark:hover:bg-slate-700'
              }`}
            >
              JSON
            </button>
          </div>

          <button
            onClick={handleCopyJson}
            className="p-2 rounded hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-400 transition"
            title="Copy to clipboard"
          >
            <Copy size={16} />
          </button>

          <button
            onClick={handleDownloadJson}
            className="p-2 rounded hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-400 transition"
            title="Download JSON"
          >
            <Download size={16} />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {viewMode === 'table' ? (
          <ResultsTable data={resultData} expandedRows={expandedRows} onToggleExpand={toggleRowExpanded} />
        ) : (
          <ResultsJson data={resultData} />
        )}
      </div>
    </div>
  );
}

interface ResultsTableProps {
  data: any[];
  expandedRows: Set<number>;
  onToggleExpand: (index: number) => void;
}

function ResultsTable({ data, expandedRows, onToggleExpand }: ResultsTableProps) {
  if (data.length === 0) {
    return (
      <div className="p-6 text-center text-slate-600 dark:text-slate-400">No results found</div>
    );
  }

  const columns = useMemo(() => {
    const cols = new Set<string>();
    data.forEach((row) => {
      Object.keys(row).forEach((key) => cols.add(key));
    });
    return Array.from(cols).slice(0, 10);
  }, [data]);

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse">
        <thead>
          <tr className="bg-slate-100 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 sticky top-0">
            <th className="w-10 px-2 py-2 text-left"></th>
            {columns.map((col) => (
              <th
                key={col}
                className="px-4 py-2 text-left text-sm font-semibold text-slate-900 dark:text-slate-50 border-r border-slate-200 dark:border-slate-800"
              >
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((row, idx) => (
            <React.Fragment key={idx}>
              <tr
                className={`border-b border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-900/50 transition ${
                  expandedRows.has(idx) ? 'bg-slate-50 dark:bg-slate-900/50' : ''
                }`}
              >
                <td className="px-2 py-2 text-left">
                  <button
                    onClick={() => onToggleExpand(idx)}
                    className="p-1 hover:bg-slate-200 dark:hover:bg-slate-800 rounded transition"
                  >
                    {expandedRows.has(idx) ? (
                      <ChevronDown size={16} />
                    ) : (
                      <ChevronRight size={16} />
                    )}
                  </button>
                </td>
                {columns.map((col) => (
                  <td
                    key={col}
                    className="px-4 py-2 text-sm text-slate-900 dark:text-slate-50 border-r border-slate-200 dark:border-slate-800 max-w-xs overflow-hidden text-ellipsis whitespace-nowrap"
                  >
                    {renderValue(row[col])}
                  </td>
                ))}
              </tr>
              {expandedRows.has(idx) && (
                <tr className="bg-slate-50 dark:bg-slate-900/30 border-b border-slate-200 dark:border-slate-800">
                  <td colSpan={columns.length + 1} className="p-4">
                    <pre className="text-xs bg-slate-900 dark:bg-slate-950 text-slate-50 p-3 rounded overflow-auto max-h-200">
                      {JSON.stringify(row, null, 2)}
                    </pre>
                  </td>
                </tr>
              )}
            </React.Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

interface ResultsJsonProps {
  data: any[];
}

function ResultsJson({ data }: ResultsJsonProps) {
  return (
    <div className="p-4">
      <pre className="text-xs bg-slate-100 dark:bg-slate-900 text-slate-900 dark:text-slate-50 p-4 rounded overflow-auto max-h-full font-mono">
        {JSON.stringify(data, null, 2)}
      </pre>
    </div>
  );
}

function renderValue(value: any): string {
  if (value === null || value === undefined) {
    return 'null';
  }
  if (typeof value === 'object') {
    return `[${Array.isArray(value) ? 'Array' : 'Object'}]`;
  }
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }
  return String(value);
}
