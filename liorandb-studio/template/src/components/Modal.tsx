'use client';

import React, { useEffect, useState } from 'react';
import { X } from 'lucide-react';

interface ModalProps {
  isOpen: boolean;
  title: string;
  children: React.ReactNode;
  onClose: () => void;
  onConfirm?: () => Promise<void> | void;
  confirmText?: string;
  isLoading?: boolean;
}

export function Modal({
  isOpen,
  title,
  children,
  onClose,
  onConfirm,
  confirmText = 'Confirm',
  isLoading = false,
}: ModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="flex w-full max-w-md flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl dark:border-slate-800 dark:bg-slate-950">
        <div className="flex items-center justify-between border-b border-slate-200 p-4 dark:border-slate-800">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{title}</h2>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-slate-500 transition hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-900"
            aria-label="Close modal"
          >
            <X size={18} />
          </button>
        </div>

        <div className="max-h-[70vh] flex-1 overflow-y-auto p-4">{children}</div>

        <div className="flex gap-2 border-t border-slate-200 p-4 dark:border-slate-800">
          <button
            onClick={onClose}
            disabled={isLoading}
            className="flex-1 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-900 transition hover:bg-slate-100 disabled:opacity-50 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-100 dark:hover:bg-slate-900"
          >
            Cancel
          </button>
          {onConfirm ? (
            <button
              onClick={onConfirm}
              disabled={isLoading}
              className="flex-1 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-emerald-700 disabled:opacity-50"
            >
              {isLoading ? 'Loading...' : confirmText}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

interface InputModalProps {
  isOpen: boolean;
  title: string;
  label: string;
  placeholder?: string;
  defaultValue?: string;
  confirmText?: string;
  onClose: () => void;
  onConfirm: (value: string) => Promise<void>;
}

export function InputModal({
  isOpen,
  title,
  label,
  placeholder,
  defaultValue = '',
  confirmText,
  onClose,
  onConfirm,
}: InputModalProps) {
  const [value, setValue] = useState(defaultValue);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    setValue(defaultValue);
  }, [defaultValue, isOpen]);

  const handleConfirm = async () => {
    if (!value.trim()) return;
    try {
      setIsLoading(true);
      await onConfirm(value.trim());
      setValue('');
      onClose();
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      title={title}
      onClose={onClose}
      onConfirm={handleConfirm}
      confirmText={confirmText}
      isLoading={isLoading}
    >
      <label className="block">
        <span className="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-300">{label}</span>
        <input
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={placeholder}
          className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 disabled:opacity-60 dark:border-slate-800 dark:bg-black dark:text-slate-100 dark:placeholder:text-slate-600"
          disabled={isLoading}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void handleConfirm();
          }}
        />
      </label>
    </Modal>
  );
}

interface JsonInputModalProps {
  isOpen: boolean;
  title: string;
  defaultValue?: string;
  confirmText?: string;
  onClose: () => void;
  onConfirm: (value: Record<string, unknown>) => Promise<void>;
}

export function JsonInputModal({
  isOpen,
  title,
  defaultValue = '{}',
  confirmText,
  onClose,
  onConfirm,
}: JsonInputModalProps) {
  const [value, setValue] = useState(defaultValue);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    setValue(defaultValue);
    setError('');
  }, [defaultValue, isOpen]);

  const handleConfirm = async () => {
    try {
      setError('');
      const parsed = JSON.parse(value) as Record<string, unknown>;
      setIsLoading(true);
      await onConfirm(parsed);
      setValue('{}');
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      title={title}
      onClose={onClose}
      onConfirm={handleConfirm}
      confirmText={confirmText}
      isLoading={isLoading}
    >
      <div className="space-y-3">
        <textarea
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="h-64 w-full resize-none rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 disabled:opacity-60 dark:border-slate-800 dark:bg-black dark:text-slate-100 dark:placeholder:text-slate-600"
          disabled={isLoading}
        />
        {error ? <p className="text-sm text-red-600 dark:text-red-300">Invalid JSON: {error}</p> : null}
      </div>
    </Modal>
  );
}

