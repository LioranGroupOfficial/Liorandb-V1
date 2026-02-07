'use client';

import React from 'react';

interface JsonViewerProps {
  data: any;
  collapsed?: boolean;
}

export function JsonViewer({ data, collapsed = false }: JsonViewerProps) {
  const [isCollapsed, setIsCollapsed] = React.useState(collapsed);

  if (data === null) {
    return <span className="text-slate-400">null</span>;
  }

  if (data === undefined) {
    return <span className="text-slate-400">undefined</span>;
  }

  if (typeof data !== 'object') {
    return <span className={getTypeColor(typeof data)}>{JSON.stringify(data)}</span>;
  }

  if (Array.isArray(data)) {
    return (
      <div>
        <span
          className="cursor-pointer text-emerald-400 select-none"
          onClick={() => setIsCollapsed(!isCollapsed)}
        >
          {isCollapsed ? '▶' : '▼'}
        </span>
        <span className="text-slate-400">[</span>
        {!isCollapsed && (
          <div className="ml-4 space-y-1">
            {data.map((item, idx) => (
              <div key={idx}>
                <span className="text-slate-500">{idx}:</span>
                <span className="ml-2">
                  <JsonViewer data={item} />
                </span>
              </div>
            ))}
          </div>
        )}
        <span className="text-slate-400">]</span>
        {isCollapsed && <span className="text-slate-500 ml-2">... ({data.length} items)</span>}
      </div>
    );
  }

  // Object
  const keys = Object.keys(data);
  return (
    <div>
      <span
        className="cursor-pointer text-emerald-400 select-none"
        onClick={() => setIsCollapsed(!isCollapsed)}
      >
        {isCollapsed ? '▶' : '▼'}
      </span>
      <span className="text-slate-400">{'{}'}</span>
      {!isCollapsed && (
        <div className="ml-4 space-y-1">
          {keys.map((key) => (
            <div key={key}>
              <span className="text-cyan-400">"{key}"</span>
              <span className="text-slate-400">: </span>
              <span className="ml-2">
                <JsonViewer data={data[key]} />
              </span>
            </div>
          ))}
        </div>
      )}
      {isCollapsed && <span className="text-slate-500 ml-2">... ({keys.length} fields)</span>}
    </div>
  );
}

function getTypeColor(type: string): string {
  switch (type) {
    case 'string':
      return 'text-amber-400';
    case 'number':
      return 'text-blue-400';
    case 'boolean':
      return 'text-pink-400';
    default:
      return 'text-slate-400';
  }
}
