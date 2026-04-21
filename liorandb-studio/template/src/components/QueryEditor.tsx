'use client';

import React, { useState } from 'react';
import { Copy, Play } from 'lucide-react';
import { useAppStore } from '@/store';
import { LioranDBService } from '@/lib/lioran';
import { copyToClipboard, formatJSON } from '@/lib/utils';
import { useToast } from './Toast';
import { JsonViewer } from './JsonViewer';

export function QueryEditor() {
  const { currentDatabase, selectedCollection, queryResults, isLoading } = useAppStore();
  const { addToast } = useToast();

  const [queryMode, setQueryMode] = useState<'find' | 'aggregate'>('find');
  const [filter, setFilter] = useState('{}');
  const [resultMode, setResultMode] = useState<'json' | 'count'>('json');

  async function executeQuery() {
    if (!currentDatabase || !selectedCollection) {
      addToast('Please select a database and collection', 'warning');
      return;
    }

    try {
      let filterObj: Record<string, unknown> = {};
      try {
        filterObj = JSON.parse(filter) as Record<string, unknown>;
      } catch {
        addToast('Invalid JSON filter', 'error');
        return;
      }

      useAppStore.setState({ isLoading: true });

      const startTime = performance.now();
      const { documents, count } = await LioranDBService.find(currentDatabase, selectedCollection, filterObj, 100);
      const executionTime = Math.round(performance.now() - startTime);

      useAppStore.setState({
        queryResults: {
          data: documents,
          count,
          executionTime,
          filter: filterObj,
        },
      });

      addToast(`Query executed in ${executionTime}ms`, 'success');
    } catch (error) {
      addToast(error instanceof Error ? error.message : 'Query failed', 'error');
    } finally {
      useAppStore.setState({ isLoading: false });
    }
  }

  async function copyResults() {
    if (!queryResults) return;
    try {
      await copyToClipboard(formatJSON(queryResults.data));
      addToast('Results copied to clipboard', 'success');
    } catch {
      addToast('Failed to copy', 'error');
    }
  }

  return (
    <div className="flex h-full flex-col gap-4 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-950">
      <div className="flex flex-1 flex-col gap-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Query</h3>
          <div className="flex gap-2">
            <button
              onClick={() => setQueryMode('find')}
              className={`rounded-md px-2 py-1 text-xs transition ${
                queryMode === 'find'
                  ? 'bg-emerald-600 text-white'
                  : 'bg-slate-100 text-slate-600 hover:text-slate-900 dark:bg-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
              }`}
            >
              Find
            </button>
            <button
              onClick={() => setQueryMode('aggregate')}
              className={`rounded-md px-2 py-1 text-xs transition ${
                queryMode === 'aggregate'
                  ? 'bg-emerald-600 text-white'
                  : 'bg-slate-100 text-slate-600 hover:text-slate-900 dark:bg-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
              }`}
              disabled
              title="Aggregate support coming soon"
            >
              Aggregate (Soon)
            </button>
          </div>
        </div>

        <textarea
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder='{"field": "value"}'
          className="flex-1 resize-none rounded-lg border border-slate-200 bg-white p-3 font-mono text-sm text-slate-900 outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 dark:border-slate-800 dark:bg-black dark:text-slate-100"
        />

        <button
          onClick={executeQuery}
          disabled={isLoading || !currentDatabase || !selectedCollection}
          className="flex items-center justify-center gap-2 rounded-lg bg-emerald-600 py-2 font-medium text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Play size={16} />
          <span>Execute Query</span>
        </button>
      </div>

      {queryResults ? (
        <div className="flex flex-1 flex-col gap-2 border-t border-slate-200 pt-4 dark:border-slate-800">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Results</h3>
              <span className="text-xs text-slate-500 dark:text-slate-400">
                {queryResults.count} documents · {queryResults.executionTime}ms
              </span>
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => setResultMode('json')}
                className={`rounded-md px-2 py-1 text-xs transition ${
                  resultMode === 'json'
                    ? 'bg-emerald-600 text-white'
                    : 'bg-slate-100 text-slate-600 hover:text-slate-900 dark:bg-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
                }`}
              >
                JSON
              </button>
              <button
                onClick={() => setResultMode('count')}
                className={`rounded-md px-2 py-1 text-xs transition ${
                  resultMode === 'count'
                    ? 'bg-emerald-600 text-white'
                    : 'bg-slate-100 text-slate-600 hover:text-slate-900 dark:bg-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
                }`}
              >
                Count
              </button>
              <button
                onClick={copyResults}
                className="flex items-center gap-1 rounded-md bg-slate-100 px-2 py-1 text-xs text-slate-600 transition hover:text-slate-900 dark:bg-slate-900 dark:text-slate-400 dark:hover:text-slate-200"
              >
                <Copy size={12} />
                Copy
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-auto rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-black">
            {resultMode === 'count' ? (
              <div className="text-center text-slate-700 dark:text-slate-300">
                <div className="mb-2 text-4xl font-bold text-emerald-600 dark:text-emerald-400">
                  {queryResults.count}
                </div>
                <p className="text-slate-500 dark:text-slate-400">documents matched</p>
              </div>
            ) : (
              <div className="space-y-2 font-mono text-xs">
                {queryResults.data.length === 0 ? (
                  <p className="text-slate-500 dark:text-slate-400">No results</p>
                ) : (
                  queryResults.data.map((doc, idx) => (
                    <div key={idx} className="text-slate-900 dark:text-slate-100">
                      <JsonViewer data={doc} collapsed={true} />
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
