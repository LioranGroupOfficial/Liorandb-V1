'use client';

import React, { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Database, Plus, Table2, Trash2 } from 'lucide-react';
import { useAppStore } from '@/store';
import { LioranDBService } from '@/lib/lioran';
import { formatCompactNumber } from '@/lib/utils';
import { Collection } from '@/types';
import { useToast } from './Toast';

interface SidebarProps {
  onDatabaseSelect: (dbName: string) => void;
  onCollectionSelect: (dbName: string, collectionName: string) => void;
  onCreateDatabase: () => void;
  onCreateCollection: () => void;
}

export function Sidebar({
  onDatabaseSelect,
  onCollectionSelect,
  onCreateDatabase,
  onCreateCollection,
}: SidebarProps) {
  const [expandedDbs, setExpandedDbs] = useState<Set<string>>(new Set());
  const [isWorking, setIsWorking] = useState(false);
  const { databases, currentDatabase, selectedCollection, collections } = useAppStore();
  const { addToast } = useToast();

  const totalCollections = useMemo(
    () => databases.reduce((sum, db) => sum + (db.collections ?? collections[db.name]?.length ?? 0), 0),
    [collections, databases]
  );

  function toggleDatabase(dbName: string) {
    setExpandedDbs((current) => {
      const next = new Set(current);

      if (next.has(dbName)) {
        next.delete(dbName);
      } else {
        next.add(dbName);
      }

      return next;
    });
  }

  async function handleDeleteDatabase(dbName: string) {
    if (!confirm(`Delete database "${dbName}"? This action cannot be undone.`)) return;

    try {
      setIsWorking(true);
      await LioranDBService.dropDatabase(dbName);
      const updated = await LioranDBService.listDatabases();
      useAppStore.setState({
        databases: updated,
        currentDatabase: currentDatabase === dbName ? null : currentDatabase,
        selectedCollection: currentDatabase === dbName ? null : selectedCollection,
      });
      addToast(`Deleted ${dbName}`, 'success');
    } catch (error) {
      addToast(error instanceof Error ? error.message : 'Failed to delete database', 'error');
    } finally {
      setIsWorking(false);
    }
  }

  async function handleDeleteCollection(dbName: string, collectionName: string) {
    if (!confirm(`Delete collection "${collectionName}"? This action cannot be undone.`)) return;

    try {
      setIsWorking(true);
      await LioranDBService.dropCollection(dbName, collectionName);
      const updatedCollections = await LioranDBService.listCollections(dbName);
      useAppStore.setState((state) => ({
        collections: {
          ...state.collections,
          [dbName]: updatedCollections,
        },
        selectedCollection:
          state.currentDatabase === dbName && state.selectedCollection === collectionName
            ? null
            : state.selectedCollection,
      }));
      addToast(`Deleted ${collectionName}`, 'success');
    } catch (error) {
      addToast(error instanceof Error ? error.message : 'Failed to delete collection', 'error');
    } finally {
      setIsWorking(false);
    }
  }

  return (
    <aside className="glass-panel min-h-0 w-[320px] rounded-[28px] p-4">
      <div className="mb-4 rounded-[24px] border border-white/8 bg-black/20 p-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-[var(--muted)]">Explorer</p>
            <h2 className="mt-1 text-xl font-semibold text-white">Databases</h2>
          </div>
          <button
            onClick={onCreateDatabase}
            className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-[var(--accent)] transition hover:bg-white/10"
            title="Create database"
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3">
          <MetricCard label="Databases" value={formatCompactNumber(databases.length)} />
          <MetricCard label="Collections" value={formatCompactNumber(totalCollections)} />
        </div>
      </div>

      <div className="min-h-0 overflow-y-auto pr-1">
        {databases.length === 0 ? (
          <div className="rounded-[24px] border border-dashed border-white/10 bg-black/10 p-6 text-center text-sm text-[var(--muted)]">
            Create your first database to unlock the collection explorer.
          </div>
        ) : (
          <div className="space-y-2">
            {databases.map((db) => {
              const isExpanded = expandedDbs.has(db.name);
              const dbCollections = collections[db.name] ?? [];

              return (
                <section
                  key={db.name}
                  className={`rounded-[24px] border p-2 transition ${
                    currentDatabase === db.name
                      ? 'border-[var(--accent)]/30 bg-[var(--accent)]/8'
                      : 'border-white/8 bg-black/15'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => toggleDatabase(db.name)}
                      className="flex h-9 w-9 items-center justify-center rounded-2xl text-[var(--muted)] transition hover:bg-white/6 hover:text-white"
                    >
                      {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                    </button>
                    <button
                      onClick={() => onDatabaseSelect(db.name)}
                      className="min-w-0 flex-1 text-left"
                    >
                      <div className="flex items-center gap-2">
                        <Database className="h-4 w-4 text-[var(--accent)]" />
                        <span className="truncate text-sm font-medium text-white">{db.name}</span>
                      </div>
                      <div className="mt-1 text-xs text-[var(--muted)]">
                        {(db.collections ?? dbCollections.length)} collections
                        {' · '}
                        {formatCompactNumber(db.documents ?? 0)} docs
                      </div>
                    </button>
                    <button
                      onClick={() => handleDeleteDatabase(db.name)}
                      disabled={isWorking}
                      className="flex h-9 w-9 items-center justify-center rounded-2xl text-[var(--muted)] transition hover:bg-[var(--danger)]/10 hover:text-[var(--danger)] disabled:opacity-50"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>

                  {isExpanded ? (
                    <div className="mt-2 space-y-1.5 pl-3">
                      {dbCollections.map((collection: Collection) => (
                        <div
                          key={collection.name}
                          className={`flex items-center gap-2 rounded-2xl px-3 py-2 transition ${
                            currentDatabase === db.name && selectedCollection === collection.name
                              ? 'bg-[var(--accent-secondary)]/14 text-white'
                              : 'text-slate-300 hover:bg-white/5'
                          }`}
                        >
                          <button
                            onClick={() => onCollectionSelect(db.name, collection.name)}
                            className="min-w-0 flex-1 text-left"
                          >
                            <div className="flex items-center gap-2">
                              <Table2 className="h-4 w-4 text-[var(--accent-secondary)]" />
                              <span className="truncate text-sm">{collection.name}</span>
                            </div>
                            <div className="mt-1 text-xs text-[var(--muted)]">
                              {formatCompactNumber(collection.count ?? 0)} docs
                            </div>
                          </button>
                          <button
                            onClick={() => handleDeleteCollection(db.name, collection.name)}
                            disabled={isWorking}
                            className="flex h-8 w-8 items-center justify-center rounded-xl text-[var(--muted)] transition hover:bg-[var(--danger)]/10 hover:text-[var(--danger)] disabled:opacity-50"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      ))}

                      <button
                        onClick={() => {
                          useAppStore.setState({ currentDatabase: db.name });
                          onCreateCollection();
                        }}
                        className="mt-1 flex w-full items-center gap-2 rounded-2xl border border-dashed border-white/10 px-3 py-2 text-sm text-[var(--muted)] transition hover:border-[var(--accent)]/30 hover:bg-white/5 hover:text-white"
                      >
                        <Plus className="h-4 w-4" />
                        New collection
                      </button>
                    </div>
                  ) : null}
                </section>
              );
            })}
          </div>
        )}
      </div>
    </aside>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/8 bg-white/5 p-3">
      <p className="text-xs uppercase tracking-[0.16em] text-[var(--muted)]">{label}</p>
      <p className="mt-2 text-lg font-semibold text-white">{value}</p>
    </div>
  );
}
