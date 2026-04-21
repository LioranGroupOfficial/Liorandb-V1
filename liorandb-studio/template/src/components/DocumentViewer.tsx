'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Copy, Edit2, Plus, Trash2 } from 'lucide-react';
import { useAppStore } from '@/store';
import { LioranDBService } from '@/lib/lioran';
import { Document } from '@/types';
import { copyToClipboard, formatJSON } from '@/lib/utils';
import { useToast } from './Toast';
import { JsonViewer } from './JsonViewer';

interface DocumentViewerProps {
  onAddDocument?: () => void;
  onEditDocument?: (doc: Document) => void;
}

export function DocumentViewer({ onAddDocument, onEditDocument }: DocumentViewerProps) {
  const { currentDatabase, selectedCollection, documents, isLoading } = useAppStore();
  const [viewMode, setViewMode] = useState<'table' | 'json'>('table');
  const { addToast } = useToast();

  useEffect(() => {
    if (!currentDatabase || !selectedCollection) return;
    void loadDocuments();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentDatabase, selectedCollection]);

  async function loadDocuments() {
    if (!currentDatabase || !selectedCollection) return;

    try {
      useAppStore.setState({ isLoading: true });
      const { documents: docs } = await LioranDBService.find(currentDatabase, selectedCollection, {}, 100);
      useAppStore.setState({ documents: docs });
    } catch (error) {
      addToast(error instanceof Error ? error.message : 'Failed to load documents', 'error');
    } finally {
      useAppStore.setState({ isLoading: false });
    }
  }

  async function handleDelete(doc: Document) {
    if (!currentDatabase || !selectedCollection) return;
    if (!confirm('Delete this document? This action cannot be undone.')) return;

    try {
      useAppStore.setState({ isLoading: true });
      await LioranDBService.deleteMany(currentDatabase, selectedCollection, { _id: doc._id });
      await loadDocuments();
      addToast('Document deleted', 'success');
    } catch (error) {
      addToast(error instanceof Error ? error.message : 'Failed to delete document', 'error');
    } finally {
      useAppStore.setState({ isLoading: false });
    }
  }

  async function handleCopy(doc: Document) {
    try {
      await copyToClipboard(formatJSON(doc));
      addToast('Copied to clipboard', 'success');
    } catch {
      addToast('Failed to copy', 'error');
    }
  }

  if (!currentDatabase || !selectedCollection) {
    return (
      <div className="flex h-full items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-400">
        <p>Select a collection to view documents</p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950">
      <div className="flex items-center justify-between gap-3 border-b border-slate-200 p-4 dark:border-slate-800">
        <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
          Documents <span className="text-slate-500 dark:text-slate-400">({documents.length})</span>
        </h3>

        <div className="flex items-center gap-3">
          <div className="flex gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-900">
            <button
              onClick={() => setViewMode('table')}
              className={`rounded-md px-3 py-1 text-sm transition ${
                viewMode === 'table'
                  ? 'bg-emerald-600 text-white'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
              }`}
            >
              Table
            </button>
            <button
              onClick={() => setViewMode('json')}
              className={`rounded-md px-3 py-1 text-sm transition ${
                viewMode === 'json'
                  ? 'bg-emerald-600 text-white'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
              }`}
            >
              JSON
            </button>
          </div>

          <button
            onClick={onAddDocument}
            disabled={isLoading}
            className="flex items-center gap-2 rounded-lg bg-emerald-600 px-3 py-2 text-white transition hover:bg-emerald-700 disabled:opacity-50"
          >
            <Plus size={16} />
            <span className="text-sm">Add Document</span>
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        {isLoading ? (
          <div className="flex h-full items-center justify-center text-slate-600 dark:text-slate-400">
            <p>Loading documents...</p>
          </div>
        ) : documents.length === 0 ? (
          <div className="flex h-full items-center justify-center text-slate-600 dark:text-slate-400">
            <p>No documents in this collection</p>
          </div>
        ) : viewMode === 'table' ? (
          <DocumentTable documents={documents} onEdit={onEditDocument} onDelete={handleDelete} onCopy={handleCopy} />
        ) : (
          <JsonViewMode documents={documents} onEdit={onEditDocument} onDelete={handleDelete} onCopy={handleCopy} />
        )}
      </div>
    </div>
  );
}

function DocumentTable({
  documents,
  onEdit,
  onDelete,
  onCopy,
}: {
  documents: Document[];
  onEdit?: (doc: Document) => void;
  onDelete: (doc: Document) => void;
  onCopy: (doc: Document) => void;
}) {
  const keys = useMemo(() => {
    const sample = documents[0] ?? {};
    const allKeys = Object.keys(sample);
    const ordered = allKeys.includes('_id')
      ? ['_id', ...allKeys.filter((key) => key !== '_id')]
      : allKeys;
    return ordered.slice(0, 5);
  }, [documents]);

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-900">
            {keys.map((key) => (
              <th key={key} className="truncate px-4 py-3 text-left text-sm font-medium text-slate-700 dark:text-slate-300">
                {key}
              </th>
            ))}
            <th className="w-24 px-4 py-3 text-left text-sm font-medium text-slate-700 dark:text-slate-300">
              Actions
            </th>
          </tr>
        </thead>
        <tbody>
          {documents.map((doc, idx) => (
            <tr
              key={idx}
              className="border-b border-slate-200 transition hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-900/50"
            >
              {keys.map((key) => (
                <td key={key} className="truncate px-4 py-3 text-sm text-slate-700 dark:text-slate-300">
                  {formatCellValue((doc as Record<string, unknown>)[key])}
                </td>
              ))}
              <td className="px-4 py-3">
                <div className="flex items-center gap-2">
                  {onEdit ? (
                    <button
                      onClick={() => onEdit(doc)}
                      className="rounded p-1 text-slate-500 transition hover:bg-slate-100 hover:text-amber-600 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-amber-300"
                      title="Edit"
                    >
                      <Edit2 size={14} />
                    </button>
                  ) : null}
                  <button
                    onClick={() => onCopy(doc)}
                    className="rounded p-1 text-slate-500 transition hover:bg-slate-100 hover:text-sky-600 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-sky-300"
                    title="Copy"
                  >
                    <Copy size={14} />
                  </button>
                  <button
                    onClick={() => onDelete(doc)}
                    className="rounded p-1 text-slate-500 transition hover:bg-red-50 hover:text-red-600 dark:text-slate-400 dark:hover:bg-red-500/10 dark:hover:text-red-300"
                    title="Delete"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function JsonViewMode({
  documents,
  onEdit,
  onDelete,
  onCopy,
}: {
  documents: Document[];
  onEdit?: (doc: Document) => void;
  onDelete: (doc: Document) => void;
  onCopy: (doc: Document) => void;
}) {
  const [expandedDocs, setExpandedDocs] = useState<Set<number>>(new Set());

  return (
    <div className="space-y-2 p-4">
      {documents.map((doc, idx) => (
        <div key={idx} className="overflow-hidden rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center justify-between px-4 py-3 transition hover:bg-slate-50 dark:hover:bg-slate-800/50">
            <button
              onClick={() => {
                const next = new Set(expandedDocs);
                if (next.has(idx)) next.delete(idx);
                else next.add(idx);
                setExpandedDocs(next);
              }}
              className="text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200"
              title={expandedDocs.has(idx) ? 'Collapse' : 'Expand'}
              aria-label={expandedDocs.has(idx) ? 'Collapse document' : 'Expand document'}
            >
              {expandedDocs.has(idx) ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            </button>
            <span className="ml-2 flex-1 font-mono text-sm text-slate-700 dark:text-slate-200">Document {idx + 1}</span>
            <div className="flex items-center gap-2">
              {onEdit ? (
                <button
                  onClick={() => onEdit(doc)}
                  className="rounded p-1 text-slate-500 transition hover:bg-slate-100 hover:text-amber-600 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-amber-300"
                  title="Edit"
                >
                  <Edit2 size={14} />
                </button>
              ) : null}
              <button
                onClick={() => onCopy(doc)}
                className="rounded p-1 text-slate-500 transition hover:bg-slate-100 hover:text-sky-600 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-sky-300"
                title="Copy"
              >
                <Copy size={14} />
              </button>
              <button
                onClick={() => onDelete(doc)}
                className="rounded p-1 text-slate-500 transition hover:bg-red-50 hover:text-red-600 dark:text-slate-400 dark:hover:bg-red-500/10 dark:hover:text-red-300"
                title="Delete"
              >
                <Trash2 size={14} />
              </button>
            </div>
          </div>
          {expandedDocs.has(idx) ? (
            <div className="border-t border-slate-200 bg-slate-50 px-4 py-3 dark:border-slate-800 dark:bg-slate-950">
              <JsonViewer data={doc} />
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function formatCellValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return `${JSON.stringify(value).slice(0, 50)}...`;
  return String(value).slice(0, 50);
}

