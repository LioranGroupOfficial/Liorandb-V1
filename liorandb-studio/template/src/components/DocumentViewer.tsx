'use client';

import React, { useEffect, useState } from 'react';
import { Plus, Edit2, Trash2, Copy } from 'lucide-react';
import { useAppStore } from '@/store';
import { LioranDBService } from '@/lib/lioran';
import { Document } from '@/types';
import { formatJSON, copyToClipboard } from '@/lib/utils';
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

    loadDocuments();
  }, [currentDatabase, selectedCollection]);

  async function loadDocuments() {
    if (!currentDatabase || !selectedCollection) return;

    try {
      useAppStore.setState({ isLoading: true });
      const { documents: docs } = await LioranDBService.find(
        currentDatabase,
        selectedCollection,
        {},
        100
      );
      useAppStore.setState({ documents: docs });
    } catch (error) {
      addToast(`Error loading documents: ${error}`, 'error');
    } finally {
      useAppStore.setState({ isLoading: false });
    }
  }

  async function handleDelete(doc: Document) {
    if (!currentDatabase || !selectedCollection) return;
    if (!confirm('Delete this document? This action cannot be undone.')) return;

    try {
      useAppStore.setState({ isLoading: true });
      const _id = doc._id;
      await LioranDBService.deleteMany(currentDatabase, selectedCollection, { _id });
      await loadDocuments();
      addToast('Document deleted', 'success');
    } catch (error) {
      addToast(`Error deleting document: ${error}`, 'error');
    } finally {
      useAppStore.setState({ isLoading: false });
    }
  }

  async function handleCopy(doc: Document) {
    try {
      await copyToClipboard(formatJSON(doc));
      addToast('Copied to clipboard', 'success');
    } catch (error) {
      addToast('Failed to copy', 'error');
    }
  }

  if (!currentDatabase || !selectedCollection) {
    return (
      <div className="flex items-center justify-center h-full text-slate-400">
        <p>Select a collection to view documents</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="p-4 border-b border-slate-800 flex items-center justify-between">
        <h3 className="text-lg font-semibold text-slate-100">
          Documents ({documents.length})
        </h3>

        <div className="flex items-center gap-3">
          <div className="flex gap-1 bg-slate-900 rounded p-1">
            <button
              onClick={() => setViewMode('table')}
              className={`px-3 py-1 rounded text-sm transition ${
                viewMode === 'table'
                  ? 'bg-emerald-600 text-white'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Table
            </button>
            <button
              onClick={() => setViewMode('json')}
              className={`px-3 py-1 rounded text-sm transition ${
                viewMode === 'json'
                  ? 'bg-emerald-600 text-white'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              JSON
            </button>
          </div>

          <button
            onClick={onAddDocument}
            disabled={isLoading}
            className="flex items-center gap-2 px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded transition disabled:opacity-50"
          >
            <Plus size={16} />
            <span className="text-sm">Add Document</span>
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {isLoading ? (
          <div className="flex items-center justify-center h-full text-slate-400">
            <p>Loading documents...</p>
          </div>
        ) : documents.length === 0 ? (
          <div className="flex items-center justify-center h-full text-slate-400">
            <p>No documents in this collection</p>
          </div>
        ) : viewMode === 'table' ? (
          <DocumentTable
            documents={documents}
            onEdit={onEditDocument}
            onDelete={handleDelete}
            onCopy={handleCopy}
          />
        ) : (
          <JsonViewMode
            documents={documents}
            onEdit={onEditDocument}
            onDelete={handleDelete}
            onCopy={handleCopy}
          />
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
  if (documents.length === 0) return null;

  const keys = Array.from(
    new Set(documents.flatMap((doc) => Object.keys(doc)))
  ).slice(0, 5); // Show first 5 columns

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b border-slate-800 bg-slate-900">
            {keys.map((key) => (
              <th
                key={key}
                className="px-4 py-3 text-left text-sm font-medium text-slate-300 truncate"
              >
                {key}
              </th>
            ))}
            <th className="px-4 py-3 text-left text-sm font-medium text-slate-300 w-24">
              Actions
            </th>
          </tr>
        </thead>
        <tbody>
          {documents.map((doc, idx) => (
            <tr
              key={idx}
              className="border-b border-slate-800 hover:bg-slate-900/50 transition"
            >
              {keys.map((key) => (
                <td
                  key={key}
                  className="px-4 py-3 text-sm text-slate-300 truncate"
                >
                  {formatCellValue(doc[key])}
                </td>
              ))}
              <td className="px-4 py-3">
                <div className="flex items-center gap-2">
                  {onEdit && (
                    <button
                      onClick={() => onEdit(doc)}
                      className="p-1 hover:bg-slate-800 rounded transition text-slate-400 hover:text-amber-400"
                      title="Edit"
                    >
                      <Edit2 size={14} />
                    </button>
                  )}
                  <button
                    onClick={() => onCopy(doc)}
                    className="p-1 hover:bg-slate-800 rounded transition text-slate-400 hover:text-cyan-400"
                    title="Copy"
                  >
                    <Copy size={14} />
                  </button>
                  <button
                    onClick={() => onDelete(doc)}
                    className="p-1 hover:bg-slate-800 rounded transition text-slate-400 hover:text-red-400"
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
        <div
          key={idx}
          className="bg-slate-900 rounded border border-slate-800 overflow-hidden"
        >
          <div className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-slate-800/50 transition">
            <button
              onClick={() => {
                const next = new Set(expandedDocs);
                next.has(idx) ? next.delete(idx) : next.add(idx);
                setExpandedDocs(next);
              }}
              className="text-slate-400 hover:text-slate-200"
            >
              {expandedDocs.has(idx) ? '▼' : '▶'}
            </button>
            <span className="flex-1 text-sm text-slate-300 ml-2 font-mono">
              Document {idx + 1}
            </span>
            <div className="flex items-center gap-2">
              {onEdit && (
                <button
                  onClick={() => onEdit(doc)}
                  className="p-1 hover:bg-slate-700 rounded transition text-slate-400 hover:text-amber-400"
                  title="Edit"
                >
                  <Edit2 size={14} />
                </button>
              )}
              <button
                onClick={() => onCopy(doc)}
                className="p-1 hover:bg-slate-700 rounded transition text-slate-400 hover:text-cyan-400"
                title="Copy"
              >
                <Copy size={14} />
              </button>
              <button
                onClick={() => onDelete(doc)}
                className="p-1 hover:bg-slate-700 rounded transition text-slate-400 hover:text-red-400"
                title="Delete"
              >
                <Trash2 size={14} />
              </button>
            </div>
          </div>
          {expandedDocs.has(idx) && (
            <div className="px-4 py-3 bg-slate-950 border-t border-slate-800">
              <JsonViewer data={doc} />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function formatCellValue(value: any): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return JSON.stringify(value).slice(0, 50) + '...';
  return String(value).slice(0, 50);
}
