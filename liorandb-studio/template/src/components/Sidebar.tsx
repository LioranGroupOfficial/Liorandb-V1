'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { ChevronDown, Database, Plus, Table2, Trash2 } from 'lucide-react';
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

  useEffect(() => {
    if (!currentDatabase) return;
    setExpandedDbs((current) => {
      const next = new Set(current);
      next.add(currentDatabase);
      return next;
    });
  }, [currentDatabase]);

  const totalCollections = useMemo(
    () => databases.reduce((sum, db) => sum + (db.collections ?? collections[db.name]?.length ?? 0), 0),
    [collections, databases]
  );

  function handleDatabaseSelect(dbName: string) {
    onDatabaseSelect(dbName);
    setExpandedDbs((current) => {
      const next = new Set(current);
      next.add(dbName);
      return next;
    });
  }

  function handleDatabaseChevronClick(dbName: string) {
    if (expandedDbs.has(dbName)) {
      setExpandedDbs((current) => {
        const next = new Set(current);
        next.delete(dbName);
        return next;
      });
      return;
    }

    // Expand should also refresh + load collections via the Dashboard effect.
    handleDatabaseSelect(dbName);
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
    <aside className="min-h-0 w-[300px] shrink-0 border-r border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-950 md:w-[320px]">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Explorer</p>
          <h2 className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">Databases</h2>
        </div>
        <button
          onClick={onCreateDatabase}
          className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-700 transition hover:bg-slate-100 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200 dark:hover:bg-slate-900"
          title="Create database"
          aria-label="Create database"
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>

      <div className="mb-3 grid grid-cols-2 gap-2">
        <MetricCard label="Databases" value={formatCompactNumber(databases.length)} />
        <MetricCard label="Collections" value={formatCompactNumber(totalCollections)} />
      </div>

      <div className="min-h-0 overflow-y-auto pr-1">
        {databases.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 p-6 text-center text-sm text-slate-600 dark:border-slate-800 dark:bg-black dark:text-slate-400">
            Create your first database to unlock the collection explorer.
          </div>
        ) : (
          <div className="space-y-2">
            {databases.map((db) => {
              const isExpanded = expandedDbs.has(db.name);
              const dbCollections = collections[db.name] ?? [];
              const isActiveDb = currentDatabase === db.name;

              return (
                <section
                  key={db.name}
                  className={`rounded-lg border p-2 transition ${
                    isActiveDb
                      ? 'border-emerald-200 bg-emerald-50 dark:border-emerald-500/30 dark:bg-emerald-500/10'
                      : 'border-slate-200 bg-white hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-950 dark:hover:bg-slate-900'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleDatabaseChevronClick(db.name)}
                      className="flex h-8 w-8 items-center justify-center rounded-md text-slate-500 transition hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                      title={isExpanded ? 'Collapse' : 'Expand'}
                      aria-label={isExpanded ? 'Collapse database' : 'Expand database'}
                    >
                      <ChevronDown className={`h-4 w-4 transition ${isExpanded ? '' : '-rotate-90'}`} />
                    </button>

                    <button onClick={() => handleDatabaseSelect(db.name)} className="min-w-0 flex-1 text-left">
                      <div className="flex items-center gap-2">
                        <Database className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                        <span className="truncate text-sm font-medium text-slate-900 dark:text-slate-100">
                          {db.name}
                        </span>
                      </div>
                      <div className="mt-1 text-xs text-slate-600 dark:text-slate-400">
                        {(db.collections ?? dbCollections.length)} collections · {formatCompactNumber(db.documents ?? 0)}{' '}
                        docs
                      </div>
                    </button>

                    <button
                      onClick={() => handleDeleteDatabase(db.name)}
                      disabled={isWorking}
                      className="flex h-8 w-8 items-center justify-center rounded-md text-slate-500 transition hover:bg-red-50 hover:text-red-600 disabled:opacity-50 dark:text-slate-400 dark:hover:bg-red-500/10 dark:hover:text-red-300"
                      title="Delete database"
                      aria-label="Delete database"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>

                  {isExpanded ? (
                    <div className="mt-2 space-y-1.5 pl-6">
                      {dbCollections.map((collection: Collection) => (
                        <div
                          key={collection.name}
                          className={`flex items-center gap-2 rounded-md px-2 py-2 transition ${
                            currentDatabase === db.name && selectedCollection === collection.name
                              ? 'bg-slate-200 text-slate-900 dark:bg-slate-800 dark:text-slate-100'
                              : 'text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-900'
                          }`}
                        >
                          <button
                            onClick={() => onCollectionSelect(db.name, collection.name)}
                            className="min-w-0 flex-1 text-left"
                          >
                            <div className="flex items-center gap-2">
                              <Table2 className="h-4 w-4 text-sky-600 dark:text-sky-400" />
                              <span className="truncate text-sm">{collection.name}</span>
                            </div>
                            <div className="mt-1 text-xs text-slate-500 dark:text-slate-500">
                              {formatCompactNumber(collection.count ?? 0)} docs
                            </div>
                          </button>

                          <button
                            onClick={() => handleDeleteCollection(db.name, collection.name)}
                            disabled={isWorking}
                            className="flex h-8 w-8 items-center justify-center rounded-md text-slate-500 transition hover:bg-red-50 hover:text-red-600 disabled:opacity-50 dark:text-slate-400 dark:hover:bg-red-500/10 dark:hover:text-red-300"
                            title="Delete collection"
                            aria-label="Delete collection"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      ))}

                      <button
                        onClick={() => {
                          handleDatabaseSelect(db.name);
                          onCreateCollection();
                        }}
                        className="mt-1 flex w-full items-center gap-2 rounded-md border border-dashed border-slate-200 bg-transparent px-2 py-2 text-sm text-slate-600 transition hover:bg-slate-100 dark:border-slate-800 dark:text-slate-400 dark:hover:bg-slate-900"
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
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-black">
      <p className="text-xs font-medium text-slate-500 dark:text-slate-400">{label}</p>
      <p className="mt-2 text-lg font-semibold text-slate-900 dark:text-slate-100">{value}</p>
    </div>
  );
}
