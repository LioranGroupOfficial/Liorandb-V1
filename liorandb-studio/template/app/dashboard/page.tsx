'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
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
  } = useAppStore();

  // Modal states
  const [createDbModal, setCreateDbModal] = useState(false);
  const [createColModal, setCreateColModal] = useState(false);
  const [addDocModal, setAddDocModal] = useState(false);
  const [editDocModal, setEditDocModal] = useState(false);
  const [editingDoc, setEditingDoc] = useState<Document | null>(null);

  // Check authentication
  useEffect(() => {
    if (!isLoggedIn) {
      router.push('/login');
    }
  }, [isLoggedIn, router]);

  // Load databases on mount
  useEffect(() => {
    if (isLoggedIn) {
      loadDatabases();
    }
  }, [isLoggedIn]);

  // Load collections when database changes
  useEffect(() => {
    if (currentDatabase) {
      loadCollections(currentDatabase);
    }
  }, [currentDatabase]);

  async function loadDatabases() {
    try {
      const databases = await LioranDBService.listDatabases();
      setDatabases(databases);
    } catch (error) {
      addToast(`Error loading databases: ${error}`, 'error');
    }
  }

  async function loadCollections(dbName: string) {
    try {
      const collections = await LioranDBService.listCollections(dbName);
      setCollections(dbName, collections);
    } catch (error) {
      addToast(`Error loading collections: ${error}`, 'error');
    }
  }

  async function handleCreateDatabase(name: string) {
    try {
      await LioranDBService.createDatabase(name);
      await loadDatabases();
      setCurrentDatabase(name);
      addToast(`Database "${name}" created`, 'success');
    } catch (error) {
      addToast(`Error creating database: ${error}`, 'error');
    }
  }

  async function handleCreateCollection(name: string) {
    if (!currentDatabase) return;
    try {
      await LioranDBService.createCollection(currentDatabase, name);
      await loadCollections(currentDatabase);
      setSelectedCollection(name);
      addToast(`Collection "${name}" created`, 'success');
    } catch (error) {
      addToast(`Error creating collection: ${error}`, 'error');
    }
  }

  async function handleAddDocument(doc: Record<string, any>) {
    if (!currentDatabase || !selectedCollection) return;
    try {
      await LioranDBService.insertOne(currentDatabase, selectedCollection, doc);
      addToast('Document added', 'success');
      setAddDocModal(false);
      // Reload documents
      const docViewer = document.querySelector('[data-reload-documents]');
      if (docViewer) {
        const event = new CustomEvent('reload');
        docViewer.dispatchEvent(event);
      }
    } catch (error) {
      addToast(`Error adding document: ${error}`, 'error');
    }
  }

  async function handleLogout() {
    if (confirm('Are you sure you want to logout?')) {
      logout();
      LioranDBService.disconnect();
      router.push('/login');
    }
  }

  return (
    <div className="h-screen flex flex-col bg-slate-950">
      {/* Navbar */}
      <Navbar onLogout={handleLogout} />

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar */}
        <Sidebar
          onDatabaseSelect={setCurrentDatabase}
          onCollectionSelect={(db, col) => {
            setCurrentDatabase(db);
            setSelectedCollection(col);
          }}
          onCreateDatabase={() => setCreateDbModal(true)}
          onCreateCollection={() => setCreateColModal(true)}
        />

        {/* Workspace */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {!currentDatabase ? (
            // Empty State
            <div className="flex-1 flex items-center justify-center text-slate-400">
              <div className="text-center">
                <div className="text-4xl mb-4">📦</div>
                <p className="text-lg">No database selected</p>
                <p className="text-sm text-slate-500">Create or select a database to get started</p>
              </div>
            </div>
          ) : !selectedCollection ? (
            // Collection Selection State
            <div className="flex-1 flex items-center justify-center text-slate-400">
              <div className="text-center">
                <div className="text-4xl mb-4">📚</div>
                <p className="text-lg">No collection selected</p>
                <p className="text-sm text-slate-500">Select or create a collection to view documents</p>
              </div>
            </div>
          ) : (
            // Two Panel Layout
            <div className="flex-1 flex overflow-hidden gap-4 p-4 bg-slate-900">
              {/* Left: Document Viewer */}
              <div className="flex-1 bg-slate-950 rounded-lg border border-slate-800 overflow-hidden flex flex-col">
                <DocumentViewer
                  onAddDocument={() => setAddDocModal(true)}
                  onEditDocument={(doc) => {
                    setEditingDoc(doc);
                    setEditDocModal(true);
                  }}
                />
              </div>

              {/* Right: Query Editor */}
              <div className="w-96 bg-slate-950 rounded-lg border border-slate-800 overflow-hidden">
                <QueryEditor />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Modals */}
      <InputModal
        isOpen={createDbModal}
        title="Create Database"
        label="Database Name"
        placeholder="mydb"
        onClose={() => setCreateDbModal(false)}
        onConfirm={handleCreateDatabase}
      />

      <InputModal
        isOpen={createColModal}
        title="Create Collection"
        label="Collection Name"
        placeholder="users"
        onClose={() => setCreateColModal(false)}
        onConfirm={handleCreateCollection}
      />

      <JsonInputModal
        isOpen={addDocModal}
        title="Add Document"
        defaultValue='{}'
        onClose={() => setAddDocModal(false)}
        onConfirm={handleAddDocument}
      />

      <JsonInputModal
        isOpen={editDocModal}
        title="Edit Document"
        defaultValue={editingDoc ? JSON.stringify(editingDoc, null, 2) : '{}'}
        onClose={() => {
          setEditDocModal(false);
          setEditingDoc(null);
        }}
        onConfirm={async (doc) => {
          if (!currentDatabase || !selectedCollection || !editingDoc) return;
          try {
            const _id = editingDoc._id;
            await LioranDBService.updateMany(
              currentDatabase,
              selectedCollection,
              { _id },
              { $set: doc }
            );
            addToast('Document updated', 'success');
            setEditDocModal(false);
            setEditingDoc(null);
          } catch (error) {
            addToast(`Error updating document: ${error}`, 'error');
          }
        }}
      />
    </div>
  );
}
