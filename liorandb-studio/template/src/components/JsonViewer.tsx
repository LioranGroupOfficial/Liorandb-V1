'use client';

import React from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';

interface JsonViewerProps {
  data: unknown;
  collapsed?: boolean;
}

export function JsonViewer({ data, collapsed = false }: JsonViewerProps) {
  const [isCollapsed, setIsCollapsed] = React.useState(collapsed);

  if (data === null) {
    return <span className="text-slate-600 dark:text-slate-400">null</span>;
  }

  if (data === undefined) {
    return <span className="text-slate-600 dark:text-slate-400">undefined</span>;
  }

  if (typeof data !== 'object') {
    return <span className={getTypeColor(typeof data)}>{JSON.stringify(data)}</span>;
  }

  if (Array.isArray(data)) {
    return (
      <div>
        <button
          type="button"
          className="inline-flex items-center text-emerald-600 hover:text-emerald-700 dark:text-emerald-400 dark:hover:text-emerald-300"
          onClick={() => setIsCollapsed((v) => !v)}
          aria-label={isCollapsed ? 'Expand array' : 'Collapse array'}
        >
          {isCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </button>
        <span className="text-slate-600 dark:text-slate-400">[</span>
        {!isCollapsed ? (
          <div className="ml-4 space-y-1">
            {data.map((item, idx) => (
              <div key={idx}>
                <span className="text-slate-500 dark:text-slate-500">{idx}:</span>
                <span className="ml-2">
                  <JsonViewer data={item} />
                </span>
              </div>
            ))}
          </div>
        ) : null}
        <span className="text-slate-600 dark:text-slate-400">]</span>
        {isCollapsed ? (
          <span className="ml-2 text-slate-500 dark:text-slate-500">… ({data.length} items)</span>
        ) : null}
      </div>
    );
  }

  const objectData = data as Record<string, unknown>;
  const keys = Object.keys(objectData);

  return (
    <div>
      <button
        type="button"
        className="inline-flex items-center text-emerald-600 hover:text-emerald-700 dark:text-emerald-400 dark:hover:text-emerald-300"
        onClick={() => setIsCollapsed((v) => !v)}
        aria-label={isCollapsed ? 'Expand object' : 'Collapse object'}
      >
        {isCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
      </button>
      <span className="text-slate-600 dark:text-slate-400">{'{}'}</span>
      {!isCollapsed ? (
        <div className="ml-4 space-y-1">
          {keys.map((key) => (
            <div key={key}>
              <span className="text-sky-600 dark:text-sky-300">&quot;{key}&quot;</span>
              <span className="text-slate-600 dark:text-slate-400">: </span>
              <span className="ml-2">
                <JsonViewer data={objectData[key]} />
              </span>
            </div>
          ))}
        </div>
      ) : null}
      {isCollapsed ? <span className="ml-2 text-slate-500 dark:text-slate-500">… ({keys.length} fields)</span> : null}
    </div>
  );
}

function getTypeColor(type: string): string {
  switch (type) {
    case 'string':
      return 'text-amber-600 dark:text-amber-300';
    case 'number':
      return 'text-blue-600 dark:text-blue-300';
    case 'boolean':
      return 'text-pink-600 dark:text-pink-300';
    default:
      return 'text-slate-700 dark:text-slate-300';
  }
}

