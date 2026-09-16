/**
 * useRecentFiles Hook
 * Requirements: 10.4
 * 
 * React hook for managing recent files history
 */

'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  type RecentFile,
  RECENT_FILES_CHANGED,
  getRecentFiles,
  addRecentFile,
  removeRecentFile,
  clearRecentFiles,
} from '@/lib/storage/recent-files';

export interface UseRecentFilesReturn {
  recentFiles: RecentFile[];
  addFile: (name: string, size: number, toolUsed: string, toolName?: string) => void;
  removeFile: (id: string) => void;
  clearAll: () => void;
  isLoading: boolean;
}

export function useRecentFiles(): UseRecentFilesReturn {
  const [recentFiles, setRecentFiles] = useState<RecentFile[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Load on mount, then follow the store: files are recorded by whatever saved them —
  // DownloadButton writes straight to storage — so polling the state once is not enough.
  useEffect(() => {
    const sync = () => setRecentFiles(getRecentFiles());
    sync();
    setIsLoading(false);
    window.addEventListener(RECENT_FILES_CHANGED, sync);
    // Another window of the same app writing the same key.
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(RECENT_FILES_CHANGED, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);

  const addFile = useCallback(
    (name: string, size: number, toolUsed: string, toolName?: string) => {
      addRecentFile(name, size, toolUsed, toolName);
      setRecentFiles(getRecentFiles());
    },
    []
  );

  const removeFile = useCallback((id: string) => {
    removeRecentFile(id);
    setRecentFiles(getRecentFiles());
  }, []);

  const clearAll = useCallback(() => {
    clearRecentFiles();
    setRecentFiles([]);
  }, []);

  return {
    recentFiles,
    addFile,
    removeFile,
    clearAll,
    isLoading,
  };
}
