'use client';

import React, { useEffect, useState } from 'react';
import { ChevronRight, ChevronDown, Plus, Trash2 } from 'lucide-react';
import { useAppStore } from '@/store';
import { LioranDBService } from '@/lib/lioran';
import { Database, Collection } from '@/types';
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
  const [isLoading, setIsLoading] = useState(false);

  const { databases, currentDatabase, selectedCollection } = useAppStore();
  const { addToast } = useToast();

  const toggleDatabase = (dbName: string) => {
    setExpandedDbs((prev) => {
      const next = new Set(prev);
      next.has(dbName) ? next.delete(dbName) : next.add(dbName);
      return next;
    });
  };

  const handleDeleteDatabase = async (dbName: string) => {
    if (!confirm(`Delete database "${dbName}"? This action cannot be undone.`)) return;

    try {
      setIsLoading(true);
      await LioranDBService.dropDatabase(dbName);
      const dbs = await LioranDBService.listDatabases();
      useAppStore.setState({ databases: dbs });
      if (currentDatabase === dbName) {
        useAppStore.setState({ currentDatabase: null, selectedCollection: null });
      }
      addToast(`Database "${dbName}" deleted`, 'success');
    } catch (error) {
      addToast(`Error deleting database: ${error}`, 'error');
    } finally {
      setIsLoading(false);
    }
  };

  const handleDeleteCollection = async (dbName: string, collectionName: string) => {
    if (!confirm(`Delete collection "${collectionName}"? This action cannot be undone.`)) return;

    try {
      setIsLoading(true);
      await LioranDBService.dropCollection(dbName, collectionName);
      const collections = await LioranDBService.listCollections(dbName);
      useAppStore.setState((state) => ({
        collections: {
          ...state.collections,
          [dbName]: collections,
        },
      }));
      if (selectedCollection === collectionName) {
        useAppStore.setState({ selectedCollection: null });
      }
      addToast(`Collection "${collectionName}" deleted`, 'success');
    } catch (error) {
      addToast(`Error deleting collection: ${error}`, 'error');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="w-64 bg-slate-950 border-r border-slate-800 flex flex-col h-full">
      {/* Header */}
      <div className="p-4 border-b border-slate-800">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-100">Databases</h2>
          <button
            onClick={onCreateDatabase}
            disabled={isLoading}
            className="p-1.5 hover:bg-slate-800 rounded transition disabled:opacity-50"
            title="Create database"
          >
            <Plus size={18} className="text-emerald-400" />
          </button>
        </div>
      </div>

      {/* Database List */}
      <div className="flex-1 overflow-y-auto">
        {databases.length === 0 ? (
          <div className="p-4 text-slate-400 text-sm text-center">
            No databases. Create one to get started.
          </div>
        ) : (
          <div className="space-y-1 p-2">
            {databases.map((db) => (
              <div key={db.name}>
                {/* Database Row */}
                <div
                  className={`flex items-center gap-2 px-3 py-2 rounded cursor-pointer transition ${
                    currentDatabase === db.name
                      ? 'bg-emerald-900/30 text-emerald-400'
                      : 'text-slate-300 hover:bg-slate-800'
                  }`}
                >
                  <button
                    onClick={() => toggleDatabase(db.name)}
                    className="p-0.5 hover:bg-slate-700 rounded transition"
                  >
                    {expandedDbs.has(db.name) ? (
                      <ChevronDown size={16} />
                    ) : (
                      <ChevronRight size={16} />
                    )}
                  </button>

                  <button
                    onClick={() => onDatabaseSelect(db.name)}
                    className="flex-1 text-left truncate font-medium"
                  >
                    {db.name}
                  </button>

                  <button
                    onClick={() => handleDeleteDatabase(db.name)}
                    disabled={isLoading}
                    className="p-0.5 hover:bg-red-900/50 hover:text-red-400 rounded transition disabled:opacity-50"
                    title="Delete database"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>

                {/* Collections */}
                {expandedDbs.has(db.name) && (
                  <div className="pl-6 space-y-1">
                    {(useAppStore.getState().collections[db.name] || []).map(
                      (col: Collection) => (
                        <div
                          key={col.name}
                          className={`flex items-center gap-2 px-3 py-2 rounded cursor-pointer transition ${
                            selectedCollection === col.name && currentDatabase === db.name
                              ? 'bg-cyan-900/30 text-cyan-400'
                              : 'text-slate-400 hover:bg-slate-800'
                          }`}
                        >
                          <span className="w-4" />
                          <button
                            onClick={() => onCollectionSelect(db.name, col.name)}
                            className="flex-1 text-left truncate text-sm"
                          >
                            {col.name}
                          </button>
                          <button
                            onClick={() => handleDeleteCollection(db.name, col.name)}
                            disabled={isLoading}
                            className="p-0.5 hover:bg-red-900/50 hover:text-red-400 rounded transition disabled:opacity-50"
                            title="Delete collection"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      )
                    )}

                    {/* Create Collection Button */}
                    <button
                      onClick={() => {
                        useAppStore.setState({ currentDatabase: db.name });
                        onCreateCollection();
                      }}
                      disabled={isLoading}
                      className="flex items-center gap-2 px-3 py-2 text-slate-400 hover:text-emerald-400 text-sm transition disabled:opacity-50 w-full rounded hover:bg-slate-800"
                    >
                      <Plus size={14} />
                      <span>New Collection</span>
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
