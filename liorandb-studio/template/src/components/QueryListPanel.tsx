'use client';

import React, { useState } from 'react';
import { Plus, XCircle, Copy } from 'lucide-react';
import { useAppStore } from '@/store';
import { Query } from '@/types';

export function QueryListPanel() {
  const { queries, activeQueryId, setActiveQuery, addQuery, deleteQuery, updateQuery } = useAppStore();
  const [newQueryName, setNewQueryName] = useState('');
  const [isAddingQuery, setIsAddingQuery] = useState(false);

  const handleCreateQuery = () => {
    if (newQueryName.trim()) {
      const newQuery: Query = {
        id: 'query_' + Date.now(),
        name: newQueryName,
        database: '',
        collection: '',
        content: 'db.collection.find({})',
        results: null,
      };
      addQuery(newQuery);
      setNewQueryName('');
      setIsAddingQuery(false);
    }
  };

  const handleDuplicateQuery = (query: Query) => {
    const duplicated: Query = {
      ...query,
      id: 'query_' + Date.now(),
      name: `${query.name} (copy)`,
    };
    addQuery(duplicated);
  };

  const handleDeleteQuery = (id: string) => {
    if (confirm('Are you sure you want to delete this query?')) {
      deleteQuery(id);
    }
  };

  const handleRenameQuery = (id: string, newName: string) => {
    updateQuery(id, { name: newName });
  };

  return (
    <div className="w-64 bg-slate-100 dark:bg-slate-900 border-r border-slate-300 dark:border-slate-700 flex flex-col h-full">
      {/* Header */}
      <div className="p-4 border-b border-slate-300 dark:border-slate-700">
        <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-50 mb-3">Queries</h2>
        {!isAddingQuery ? (
          <button
            onClick={() => setIsAddingQuery(true)}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white transition"
          >
            <Plus size={16} />
            New Query
          </button>
        ) : (
          <div className="space-y-2">
            <input
              type="text"
              placeholder="Query name..."
              value={newQueryName}
              onChange={(e) => setNewQueryName(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
              onKeyPress={(e) => e.key === 'Enter' && handleCreateQuery()}
            />
            <div className="flex gap-2">
              <button
                onClick={handleCreateQuery}
                className="flex-1 px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white transition text-sm"
              >
                Create
              </button>
              <button
                onClick={() => setIsAddingQuery(false)}
                className="flex-1 px-3 py-2 rounded-lg bg-slate-300 dark:bg-slate-700 hover:bg-slate-400 dark:hover:bg-slate-600 text-slate-900 dark:text-slate-50 transition text-sm"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Query List */}
      <div className="flex-1 overflow-y-auto">
        {queries.length === 0 ? (
          <div className="p-4 text-center text-slate-600 dark:text-slate-400 text-sm">
            No queries yet. Create one to get started!
          </div>
        ) : (
          <div className="p-2 space-y-1">
            {queries.map((query) => (
              <div
                key={query.id}
                className={`group relative rounded-lg transition cursor-pointer ${
                  activeQueryId === query.id
                    ? 'bg-blue-500 text-white'
                    : 'bg-slate-200 dark:bg-slate-800 text-slate-900 dark:text-slate-50 hover:bg-slate-300 dark:hover:bg-slate-700'
                }`}
              >
                <div
                  onClick={() => setActiveQuery(query.id)}
                  className="px-3 py-2 rounded-lg flex items-center justify-between min-h-[40px]"
                >
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate text-sm">{query.name}</div>
                    {query.database && (
                      <div
                        className={`text-xs truncate ${
                          activeQueryId === query.id ? 'text-blue-100' : 'text-slate-600 dark:text-slate-400'
                        }`}
                      >
                        {query.database}.{query.collection}
                      </div>
                    )}
                  </div>
                  {query.isRunning && (
                    <div className="ml-2 inline-flex items-center">
                      <div
                        className={`w-2 h-2 rounded-full animate-pulse ${
                          activeQueryId === query.id ? 'bg-blue-100' : 'bg-blue-500'
                        }`}
                      />
                    </div>
                  )}
                </div>

                {/* Hover actions */}
                <div className="hidden group-hover:flex absolute right-2 top-1/2 -translate-y-1/2 gap-1">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDuplicateQuery(query);
                    }}
                    className="p-1 rounded hover:bg-blue-600 transition"
                    title="Duplicate"
                  >
                    <Copy size={14} />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteQuery(query.id);
                    }}
                    className="p-1 rounded hover:bg-red-600 transition"
                    title="Delete"
                  >
                    <XCircle size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Footer - Stats */}
      <div className="p-4 border-t border-slate-300 dark:border-slate-700 text-xs text-slate-600 dark:text-slate-400 space-y-1">
        <div className="flex justify-between">
          <span>Total Queries:</span>
          <span className="font-semibold text-slate-900 dark:text-slate-50">{queries.length}</span>
        </div>
        <div className="flex justify-between">
          <span>Recent:</span>
          <span className="font-semibold text-slate-900 dark:text-slate-50">
            {queries.filter((q) => q.executedAt).length}
          </span>
        </div>
      </div>
    </div>
  );
}
