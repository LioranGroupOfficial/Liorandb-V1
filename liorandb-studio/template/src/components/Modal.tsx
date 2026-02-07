'use client';

import React, { useState, useEffect } from 'react';
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
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-slate-900 rounded-lg border border-slate-800 w-full max-w-md max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-slate-800">
          <h2 className="text-lg font-semibold text-slate-100">{title}</h2>
          <button
            onClick={onClose}
            className="p-1 hover:bg-slate-800 rounded transition text-slate-400"
          >
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">{children}</div>

        {/* Footer */}
        <div className="flex gap-2 p-4 border-t border-slate-800">
          <button
            onClick={onClose}
            disabled={isLoading}
            className="flex-1 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-100 rounded transition disabled:opacity-50"
          >
            Cancel
          </button>
          {onConfirm && (
            <button
              onClick={onConfirm}
              disabled={isLoading}
              className="flex-1 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded transition disabled:opacity-50 font-medium"
            >
              {isLoading ? 'Loading...' : confirmText}
            </button>
          )}
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
  onClose: () => void;
  onConfirm: (value: string) => Promise<void>;
}

export function InputModal({
  isOpen,
  title,
  label,
  placeholder,
  defaultValue = '',
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
      isLoading={isLoading}
    >
      <div className="space-y-4">
        <label className="block">
          <span className="block text-sm font-medium text-slate-300 mb-2">{label}</span>
          <input
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={placeholder}
            className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-slate-100 placeholder-slate-500 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
            disabled={isLoading}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleConfirm();
            }}
          />
        </label>
      </div>
    </Modal>
  );
}

interface JsonInputModalProps {
  isOpen: boolean;
  title: string;
  defaultValue?: string;
  onClose: () => void;
  onConfirm: (value: Record<string, any>) => Promise<void>;
}

export function JsonInputModal({
  isOpen,
  title,
  defaultValue = '{}',
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
      const parsed = JSON.parse(value);
      setIsLoading(true);
      await onConfirm(parsed);
      setValue('{}');
      onClose();
    } catch (err) {
      setError(`Invalid JSON: ${err}`);
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
      isLoading={isLoading}
    >
      <div className="space-y-3">
        <textarea
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="w-full h-64 bg-slate-800 border border-slate-700 rounded px-3 py-2 text-slate-100 font-mono text-sm placeholder-slate-500 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 resize-none"
          disabled={isLoading}
        />
        {error && <p className="text-sm text-red-400">{error}</p>}
      </div>
    </Modal>
  );
}
