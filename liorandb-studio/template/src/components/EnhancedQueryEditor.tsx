'use client';

import React, { useCallback } from 'react';
import Editor from '@monaco-editor/react';
import { useAppStore } from '@/store';
import { useThemeStore } from '@/store/theme';
import { Query } from '@/types';

interface EnhancedQueryEditorProps {
  query: Query;
}

export function EnhancedQueryEditor({ query }: EnhancedQueryEditorProps) {
  const { updateQuery } = useAppStore();
  const { theme } = useThemeStore();

  const handleChange = useCallback(
    (value: string | undefined) => {
      if (value !== undefined) {
        updateQuery(query.id, { content: value });
      }
    },
    [query.id, updateQuery]
  );

  return (
    <div className="w-full h-full flex flex-col bg-white dark:bg-slate-950">
      {/* Header */}
      <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900">
        <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-50">Query Editor</h3>
      </div>

      {/* Editor */}
      <div className="flex-1 overflow-hidden">
        <Editor
          height="100%"
          defaultLanguage="javascript"
          value={query.content}
          onChange={handleChange}
          theme={theme === 'dark' ? 'vs-dark' : 'vs-light'}
          options={{
            minimap: { enabled: false },
            fontSize: 13,
            fontFamily: "'Monaco', 'Menlo', 'Ubuntu Mono', 'Consolas', 'source-code-pro', monospace",
            lineNumbers: 'on',
            formatOnPaste: true,
            formatOnType: true,
            wordWrap: 'on',
            padding: { top: 10, bottom: 10 },
          }}
        />
      </div>
    </div>
  );
}
