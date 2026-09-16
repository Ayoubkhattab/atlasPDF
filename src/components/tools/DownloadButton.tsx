'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button, type ButtonProps } from '../ui/Button';
import { addRecentFile } from '@/lib/storage/recent-files';
import { useToolContext } from '@/lib/contexts/ToolContext';
import { sanitizeFilename } from '@/lib/utils/sanitize';
import { isTauri, saveFile, writeFileBytes } from '@/lib/tauri-bridge';

export interface DownloadButtonProps extends Omit<ButtonProps, 'onClick' | 'children'> {
  /** Blob data to download */
  file: Blob | null;
  /** Filename for the download */
  filename: string;
  /** Custom button text */
  label?: string;
  /** Callback after download starts */
  onDownloadStart?: () => void;
  /** Callback after download completes */
  onDownloadComplete?: () => void;
  /** Auto-revoke blob URL after download (default: true) */
  autoRevoke?: boolean;
  /** Show file size in button */
  showFileSize?: boolean;
  /** Tool slug for recent files tracking (optional, uses context if not provided) */
  toolSlug?: string;
  /** Tool display name for recent files tracking (optional, uses context if not provided) */
  toolName?: string;
}

/**
 * Format file size for display
 */
function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

/**
 * DownloadButton Component
 * Requirements: 5.4
 * 
 * Generates download link from Blob with custom filename.
 * Uses blob URLs that are revoked after download for security.
 */
export const DownloadButton: React.FC<DownloadButtonProps> = ({
  file,
  filename,
  label,
  onDownloadStart,
  onDownloadComplete,
  autoRevoke = true,
  showFileSize = true,
  disabled = false,
  variant = 'primary',
  size = 'md',
  className = '',
  toolSlug: propToolSlug,
  toolName: propToolName,
  ...buttonProps
}) => {
  const t = useTranslations('common');
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);
  /** Where the desktop app last wrote the file — the browser has its own download UI, we don't. */
  const [savedPath, setSavedPath] = useState<string | null>(null);
  
  // Get tool info from context if not provided via props
  const toolContext = useToolContext();
  const toolSlug = propToolSlug || toolContext?.toolSlug;
  const toolName = propToolName || toolContext?.toolName;

  // Create blob URL when file changes
  useEffect(() => {
    if (file) {
      const url = URL.createObjectURL(file);
      setBlobUrl(url);
      
      // Cleanup function to revoke URL when component unmounts or file changes
      return () => {
        URL.revokeObjectURL(url);
      };
    } else {
      setBlobUrl(null);
    }
  }, [file]);

  /**
   * Handle download click
   */
  const handleDownload = useCallback(async () => {
    if (!file || !blobUrl || isDownloading) return;

    setIsDownloading(true);
    onDownloadStart?.();
    setSavedPath(null);

    // Sanitize filename to prevent path traversal
    const safeFilename = sanitizeFilename(filename, 'download.pdf');

    if (isTauri()) {
      // Left to the webview, the desktop app drops the file into the OS download folder with no
      // dialog and nothing on screen — people cannot tell whether anything happened. Ask where it
      // should go, write it there, and say so.
      try {
        const extension = safeFilename.includes('.') ? safeFilename.split('.').pop()! : '';
        const path = await saveFile(safeFilename, extension
          ? [{ name: extension.toUpperCase(), extensions: [extension] }]
          : []);
        if (path) {
          await writeFileBytes(path, new Uint8Array(await file.arrayBuffer()));
          setSavedPath(path);
          onDownloadComplete?.();
          if (toolSlug) addRecentFile(filename, file.size, toolSlug, toolName);
        }
      } catch (error) {
        // Dismissing the save dialog is a decision, not a failure.
        const message = error instanceof Error ? error.message : String(error);
        if (!/no file selected/i.test(message)) {
          console.error('[Download] Could not save the file:', error);
        }
      } finally {
        setIsDownloading(false);
      }
      return;
    }

    // Create a temporary anchor element
    const link = document.createElement('a');
    link.href = blobUrl;
    link.download = safeFilename;
    link.style.display = 'none';
    
    // Append to body, click, and remove
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    // Revoke the blob URL after a short delay to ensure download starts
    if (autoRevoke) {
      setTimeout(() => {
        URL.revokeObjectURL(blobUrl);
        setBlobUrl(null);
        
        // Recreate URL for potential re-download
        if (file) {
          const newUrl = URL.createObjectURL(file);
          setBlobUrl(newUrl);
        }
      }, 100);
    }

    // Mark download as complete
    setTimeout(() => {
      setIsDownloading(false);
      onDownloadComplete?.();
      
      // Record to recent files if tool info is provided
      if (toolSlug && file) {
        addRecentFile(filename, file.size, toolSlug, toolName);
      }
    }, 500);
  }, [file, blobUrl, filename, isDownloading, autoRevoke, onDownloadStart, onDownloadComplete, toolSlug, toolName]);

  // Determine if button should be disabled
  const isDisabled = disabled || !file || !blobUrl;

  // Build button text
  const buttonText = savedPath
    ? (t('buttons.saved') || 'Saved')
    : label || t('buttons.download');
  const fileSizeText = showFileSize && file ? ` (${formatFileSize(file.size)})` : '';

  return (
    <Button
      variant={variant}
      size={size}
      disabled={isDisabled}
      loading={isDownloading}
      onClick={handleDownload}
      className={className}
      // The full destination, for anyone who wants to know exactly where it went.
      title={savedPath ?? undefined}
      aria-label={savedPath ? `${buttonText}: ${savedPath}` : `${buttonText}${fileSizeText}`}
      {...buttonProps}
    >
      {savedPath && !isDownloading && (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
        </svg>
      )}

      {/* Download icon */}
      {!isDownloading && !savedPath && (
        <svg
          className="w-5 h-5"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
          />
        </svg>
      )}
      
      <span>
        {buttonText}
        {savedPath ? '' : fileSizeText}
      </span>
    </Button>
  );
};

export default DownloadButton;
