'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { DatabaseZap, FolderPlus, Plus, TableProperties } from 'lucide-react';
import { useAppStore } from '@/store';
import { LioranDBService } from '@/lib/lioran';
import { Sidebar } from '@/components/Sidebar';
import { Navbar } from '@/components/Navbar';
import { DocumentViewer } from '@/components/DocumentViewer';
import { QueryEditor } from '@/components/QueryEditor';
import { InputModal, JsonInputModal } from '@/components/Modal';
import { useToast } from '@/components/Toast';
import { Document } from '@/types';

export default function DashboardPage() {
  const router = useRouter();
  const { addToast } = useToast();

  const {
    isLoggedIn,
    currentDatabase,
    selectedCollection,
    logout,
    setCurrentDatabase,
    setSelectedCollection,
    setDatabases,
    setCollections,
    setLoading,
  } = useAppStore();

  const [createDbModal, setCreateDbModal] = useState(false);
  const [createColModal, setCreateColModal] = useState(false);
  const [addDocModal, setAddDocModal] = useState(false);
  const [editDocModal, setEditDocModal] = useState(false);
  const [editingDoc, setEditingDoc] = useState<Document | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const loadDatabases = useCallback(async () => {
    try {
      setLoading(true);
      const databases = await LioranDBService.listDatabases();
      setDatabases(databases);
    } catch (error) {
      addToast(error instanceof Error ? error.message : 'Failed to load databases', 'error');
    } finally {
      setLoading(false);
    }
  }, [addToast, setDatabases, setLoading]);

  const loadCollections = useCallback(
    async (dbName: string) => {
      try {
        const collections = await LioranDBService.listCollections(dbName);
        setCollections(dbName, collections);
      } catch (error) {
        addToast(error instanceof Error ? error.message : 'Failed to load collections', 'error');
      }
    },
    [addToast, setCollections]
  );

  useEffect(() => {
    function handleRefreshMetadata() {
      if (!currentDatabase) return;
      void loadDatabases();
      void loadCollections(currentDatabase);
    }

    window.addEventListener('liorandb:refresh-metadata', handleRefreshMetadata as EventListener);
    return () => window.removeEventListener('liorandb:refresh-metadata', handleRefreshMetadata as EventListener);
  }, [currentDatabase, loadCollections, loadDatabases]);

  useEffect(() => {
    if (!isLoggedIn) {
      router.replace('/login');
    }
  }, [isLoggedIn, router]);

  useEffect(() => {
    if (isLoggedIn) {
      void loadDatabases();
    }
  }, [isLoggedIn, loadDatabases]);

  useEffect(() => {
    if (currentDatabase) {
      void loadCollections(currentDatabase);
    }
  }, [currentDatabase, loadCollections]);

  async function handleCreateDatabase(name: string) {
    await LioranDBService.createDatabase(name);
    await loadDatabases();
    setCurrentDatabase(name);
    addToast(`Database "${name}" created`, 'success');
  }

  async function handleCreateCollection(name: string) {
    if (!currentDatabase) return;

    await LioranDBService.createCollection(currentDatabase, name);
    await loadCollections(currentDatabase);
    setSelectedCollection(name);
    addToast(`Collection "${name}" created`, 'success');
  }

  async function handleAddDocument(doc: Record<string, unknown>) {
    if (!currentDatabase || !selectedCollection) return;

    await LioranDBService.insertOne(currentDatabase, selectedCollection, doc as unknown as Document);
    addToast('Document inserted', 'success');
    setAddDocModal(false);
    window.dispatchEvent(new CustomEvent('liorandb:reload-documents'));
    window.dispatchEvent(new CustomEvent('liorandb:refresh-metadata'));
  }

  async function handleEditDocument(doc: Record<string, unknown>) {
    if (!currentDatabase || !selectedCollection || !editingDoc) return;

    await LioranDBService.updateMany(currentDatabase, selectedCollection, { _id: editingDoc._id }, { $set: doc });

    addToast('Document updated', 'success');
    setEditDocModal(false);
    setEditingDoc(null);
    window.dispatchEvent(new CustomEvent('liorandb:reload-documents'));
    window.dispatchEvent(new CustomEvent('liorandb:refresh-metadata'));
  }

  function handleLogout() {
    logout();
    LioranDBService.disconnect();
    router.replace('/login');
  }

  return (
    <div className="flex h-dvh min-h-0 flex-col overflow-hidden">
      <Navbar onLogout={handleLogout} onToggleSidebar={() => setSidebarOpen((open) => !open)} />

      {sidebarOpen ? (
        <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true">
          <button
            type="button"
            className="absolute inset-0 bg-black/40"
            onClick={() => setSidebarOpen(false)}
            aria-label="Close explorer"
          />
          <div className="absolute left-0 top-0 h-full w-[320px] max-w-[85vw] shadow-xl">
            <Sidebar
              onDatabaseSelect={(db) => {
                setCurrentDatabase(db);
              }}
              onCollectionSelect={(db, col) => {
                setCurrentDatabase(db);
                setSelectedCollection(col);
                setSidebarOpen(false);
              }}
              onCreateDatabase={() => {
                setCreateDbModal(true);
              }}
              onCreateCollection={() => {
                setCreateColModal(true);
              }}
            />
          </div>
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1">
        <div className="hidden md:block">
          <Sidebar
            onDatabaseSelect={setCurrentDatabase}
            onCollectionSelect={(db, col) => {
              setCurrentDatabase(db);
              setSelectedCollection(col);
            }}
            onCreateDatabase={() => setCreateDbModal(true)}
            onCreateCollection={() => setCreateColModal(true)}
          />
        </div>

        <main className="flex min-h-0 flex-1 flex-col overflow-auto bg-slate-100 p-3 dark:bg-black md:p-4 lg:overflow-hidden">
          {!currentDatabase ? (
            <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto">
              <EmptyState
                icon={<DatabaseZap className="h-10 w-10 text-emerald-600 dark:text-emerald-400" />}
                title="Start with a database"
                description="Create a database on the left and the studio will build the rest of the workspace around it."
                actionLabel="Create database"
                onAction={() => setCreateDbModal(true)}
              />
            </div>
          ) : !selectedCollection ? (
            <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto">
              <EmptyState
                icon={<TableProperties className="h-10 w-10 text-sky-600 dark:text-sky-400" />}
                title={`Inside ${currentDatabase}`}
                description="Pick a collection from the explorer or create a new one to inspect documents and run filters."
                actionLabel="Create collection"
                onAction={() => setCreateColModal(true)}
              />
            </div>
          ) : (
            <div className="grid min-h-0 flex-1 grid-rows-[minmax(0,1.35fr)_minmax(0,1fr)] gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(320px,420px)] lg:grid-rows-1 lg:overflow-hidden xl:grid-cols-[minmax(0,1.35fr)_minmax(360px,480px)]">
              <DocumentViewer
                onAddDocument={() => setAddDocModal(true)}
                onEditDocument={(doc) => {
                  setEditingDoc(doc);
                  setEditDocModal(true);
                }}
              />
              <QueryEditor />
            </div>
          )}
        </main>
      </div>

      <InputModal
        isOpen={createDbModal}
        title="Create Database"
        label="Database name"
        placeholder="app"
        confirmText="Create database"
        onClose={() => setCreateDbModal(false)}
        onConfirm={handleCreateDatabase}
      />

      <InputModal
        isOpen={createColModal}
        title="Create Collection"
        label="Collection name"
        placeholder="users"
        confirmText="Create collection"
        onClose={() => setCreateColModal(false)}
        onConfirm={handleCreateCollection}
      />

      <JsonInputModal
        isOpen={addDocModal}
        title="Insert Document"
        defaultValue={'{\n  "name": "Ada Lovelace"\n}'}
        confirmText="Insert document"
        onClose={() => setAddDocModal(false)}
        onConfirm={handleAddDocument}
      />

      <JsonInputModal
        isOpen={editDocModal}
        title="Edit Document"
        defaultValue={editingDoc ? JSON.stringify(editingDoc, null, 2) : '{}'}
        confirmText="Save changes"
        onClose={() => {
          setEditDocModal(false);
          setEditingDoc(null);
        }}
        onConfirm={handleEditDocument}
      />
    </div>
  );
}

function EmptyState({
  icon,
  title,
  description,
  actionLabel,
  onAction,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  actionLabel: string;
  onAction: () => void;
}) {
  return (
    <div className="flex h-full items-center justify-center rounded-xl border border-slate-200 bg-white p-6 text-slate-900 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-100">
      <div className="max-w-xl text-center">
        <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-xl border border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-black">
          {icon}
        </div>
        <h2 className="text-2xl font-semibold">{title}</h2>
        <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-400 md:text-base">{description}</p>
        <button
          onClick={onAction}
          className="mt-5 inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-900 transition hover:bg-slate-100 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-100 dark:hover:bg-slate-900"
        >
          {actionLabel.includes('database') ? <FolderPlus className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
          {actionLabel}
        </button>
      </div>
    </div>
  );
}

