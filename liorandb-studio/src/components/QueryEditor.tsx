'use client';

import React, { useState } from 'react';
import { Play, Copy } from 'lucide-react';
import { useAppStore } from '@/store';
import { LioranDBService } from '@/lib/lioran';
import { useToast } from './Toast';
import { formatJSON, copyToClipboard } from '@/lib/utils';
import { JsonViewer } from './JsonViewer';

interface QueryEditorProps {}

export function QueryEditor({}: QueryEditorProps) {
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
      let filterObj: Record<string, any> = {};
      try {
        filterObj = JSON.parse(filter);
      } catch {
        addToast('Invalid JSON filter', 'error');
        return;
      }

      useAppStore.setState({ isLoading: true });

      const startTime = performance.now();
      const { documents, count } = await LioranDBService.find(
        currentDatabase,
        selectedCollection,
        filterObj,
        100
      );
      const executionTime = Math.round(performance.now() - startTime);

      useAppStore.setState({
        queryResults: {
          data: documents,
          count,
          executionTime,
        },
      });

      addToast(`Query executed in ${executionTime}ms`, 'success');
    } catch (error) {
      addToast(`Query error: ${error}`, 'error');
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
    <div className="flex flex-col h-full gap-4 p-4">
      {/* Query Editor */}
      <div className="flex-1 flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-100">Query</h3>
          <div className="flex gap-2">
            <button
              onClick={() => setQueryMode('find')}
              className={`px-2 py-1 text-xs rounded transition ${
                queryMode === 'find'
                  ? 'bg-emerald-600 text-white'
                  : 'bg-slate-800 text-slate-400 hover:text-slate-200'
              }`}
            >
              Find
            </button>
            <button
              onClick={() => setQueryMode('aggregate')}
              className={`px-2 py-1 text-xs rounded transition ${
                queryMode === 'aggregate'
                  ? 'bg-emerald-600 text-white'
                  : 'bg-slate-800 text-slate-400 hover:text-slate-200'
              }`}
              disabled
            >
              Aggregate (Soon)
            </button>
          </div>
        </div>

        <textarea
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder='{"field": "value"}'
          className="flex-1 bg-slate-900 border border-slate-800 rounded font-mono text-sm text-slate-100 p-3 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 resize-none"
        />

        <button
          onClick={executeQuery}
          disabled={isLoading || !currentDatabase || !selectedCollection}
          className="flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded py-2 transition disabled:opacity-50 disabled:cursor-not-allowed font-medium"
        >
          <Play size={16} />
          <span>Execute Query</span>
        </button>
      </div>

      {/* Results */}
      {queryResults && (
        <div className="flex-1 flex flex-col gap-2 border-t border-slate-800 pt-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <h3 className="text-sm font-semibold text-slate-100">Results</h3>
              <span className="text-xs text-slate-400">
                {queryResults.count} documents • {queryResults.executionTime}ms
              </span>
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => setResultMode('json')}
                className={`px-2 py-1 text-xs rounded transition ${
                  resultMode === 'json'
                    ? 'bg-emerald-600 text-white'
                    : 'bg-slate-800 text-slate-400 hover:text-slate-200'
                }`}
              >
                JSON
              </button>
              <button
                onClick={() => setResultMode('count')}
                className={`px-2 py-1 text-xs rounded transition ${
                  resultMode === 'count'
                    ? 'bg-emerald-600 text-white'
                    : 'bg-slate-800 text-slate-400 hover:text-slate-200'
                }`}
              >
                Count
              </button>
              <button
                onClick={copyResults}
                className="px-2 py-1 text-xs rounded bg-slate-800 text-slate-400 hover:text-slate-200 transition flex items-center gap-1"
              >
                <Copy size={12} />
                Copy
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-auto bg-slate-900 rounded border border-slate-800 p-3">
            {resultMode === 'count' ? (
              <div className="text-center text-slate-300">
                <div className="text-4xl font-bold text-emerald-400 mb-2">
                  {queryResults.count}
                </div>
                <p className="text-slate-400">documents matched</p>
              </div>
            ) : (
              <div className="font-mono text-xs space-y-2">
                {queryResults.data.length === 0 ? (
                  <p className="text-slate-400">No results</p>
                ) : (
                  queryResults.data.map((doc, idx) => (
                    <div key={idx} className="text-cyan-400">
                      <JsonViewer data={doc} collapsed={true} />
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
