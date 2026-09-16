import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { DownloadButton } from '@/components/tools/DownloadButton';

// Mock next-intl
vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => {
    const translations: Record<string, string> = {
      'buttons.download': 'Download',
      'buttons.saved': 'Saved',
    };
    return translations[key] || key;
  },
}));

// The desktop bridge: the browser path must keep working when isTauri() is false, and the save
// dialog must be what runs when it is true.
// vi.mock factories are hoisted above plain declarations, so the doubles have to be hoisted too.
const { mockIsTauri, mockSaveFile, mockWriteFileBytes, mockAddRecentFile } = vi.hoisted(() => ({
  mockIsTauri: vi.fn(() => false),
  mockSaveFile: vi.fn(async (name: string, _filters?: unknown) => `C:\\Users\\test\\Documents\\${name}`),
  mockWriteFileBytes: vi.fn(async (_path: string, _data: Uint8Array) => undefined),
  mockAddRecentFile: vi.fn(),
}));
vi.mock('@/lib/tauri-bridge', () => ({
  isTauri: () => mockIsTauri(),
  saveFile: (name: string, filters: unknown) => mockSaveFile(name, filters),
  writeFileBytes: (path: string, data: Uint8Array) => mockWriteFileBytes(path, data),
}));

vi.mock('@/lib/storage/recent-files', () => ({
  addRecentFile: (...args: unknown[]) => mockAddRecentFile(...args),
}));

// Store original URL methods
const originalCreateObjectURL = URL.createObjectURL;
const originalRevokeObjectURL = URL.revokeObjectURL;

// Mock URL methods
const mockCreateObjectURL = vi.fn(() => 'blob:mock-url');
const mockRevokeObjectURL = vi.fn();

beforeEach(() => {
  URL.createObjectURL = mockCreateObjectURL;
  URL.revokeObjectURL = mockRevokeObjectURL;
  vi.clearAllMocks();
});

afterEach(() => {
  URL.createObjectURL = originalCreateObjectURL;
  URL.revokeObjectURL = originalRevokeObjectURL;
  cleanup();
});

/**
 * Create a mock Blob
 */
function createMockBlob(content: string, type: string = 'application/pdf'): Blob {
  const blob = new Blob([content], { type });
  // jsdom ships a Blob without arrayBuffer(), which the desktop save path legitimately uses
  // to get the bytes it writes. Fill the gap here rather than bending the component around it.
  if (typeof blob.arrayBuffer !== 'function') {
    Object.defineProperty(blob, 'arrayBuffer', {
      value: async () => new TextEncoder().encode(content).buffer,
    });
  }
  return blob;
}

describe('DownloadButton', () => {
  describe('Rendering', () => {
    it('renders with default label', () => {
      const mockBlob = createMockBlob('test content');
      render(<DownloadButton file={mockBlob} filename="test.pdf" />);
      
      expect(screen.getByRole('button', { name: /download/i })).toBeInTheDocument();
    });

    it('renders with custom label', () => {
      const mockBlob = createMockBlob('test content');
      render(
        <DownloadButton 
          file={mockBlob} 
          filename="test.pdf"
          label="Save File"
          showFileSize={false}
        />
      );
      
      expect(screen.getByText('Save File')).toBeInTheDocument();
    });

    it('displays file size when showFileSize is true', () => {
      const mockBlob = createMockBlob('a'.repeat(1024)); // 1KB
      render(
        <DownloadButton 
          file={mockBlob} 
          filename="test.pdf"
          showFileSize={true}
        />
      );
      
      expect(screen.getByText(/1.*KB/)).toBeInTheDocument();
    });

    it('does not display file size when showFileSize is false', () => {
      const mockBlob = createMockBlob('a'.repeat(1024));
      render(
        <DownloadButton 
          file={mockBlob} 
          filename="test.pdf"
          showFileSize={false}
        />
      );
      
      expect(screen.queryByText(/KB/)).not.toBeInTheDocument();
    });

    it('renders download icon', () => {
      const mockBlob = createMockBlob('test content');
      render(<DownloadButton file={mockBlob} filename="test.pdf" />);
      
      const button = screen.getByRole('button');
      expect(button.querySelector('svg')).toBeInTheDocument();
    });
  });

  describe('Disabled State', () => {
    it('is disabled when file is null', () => {
      render(<DownloadButton file={null} filename="test.pdf" />);
      
      expect(screen.getByRole('button')).toBeDisabled();
    });

    it('is disabled when disabled prop is true', () => {
      const mockBlob = createMockBlob('test content');
      render(
        <DownloadButton 
          file={mockBlob} 
          filename="test.pdf"
          disabled={true}
        />
      );
      
      expect(screen.getByRole('button')).toBeDisabled();
    });

    it('is enabled when file is provided and not disabled', () => {
      const mockBlob = createMockBlob('test content');
      render(<DownloadButton file={mockBlob} filename="test.pdf" />);
      
      expect(screen.getByRole('button')).not.toBeDisabled();
    });
  });

  describe('Download Functionality', () => {
    it('creates blob URL when file is provided', () => {
      const mockBlob = createMockBlob('test content');
      render(<DownloadButton file={mockBlob} filename="test.pdf" />);
      
      expect(mockCreateObjectURL).toHaveBeenCalledWith(mockBlob);
    });

    it('calls onDownloadStart when clicked', () => {
      const mockBlob = createMockBlob('test content');
      const mockOnDownloadStart = vi.fn();
      
      render(
        <DownloadButton 
          file={mockBlob} 
          filename="test.pdf"
          onDownloadStart={mockOnDownloadStart}
        />
      );
      
      fireEvent.click(screen.getByRole('button'));
      
      expect(mockOnDownloadStart).toHaveBeenCalled();
    });

    it('calls onDownloadComplete after download', async () => {
      vi.useFakeTimers();
      
      const mockBlob = createMockBlob('test content');
      const mockOnDownloadComplete = vi.fn();
      
      render(
        <DownloadButton 
          file={mockBlob} 
          filename="test.pdf"
          onDownloadComplete={mockOnDownloadComplete}
        />
      );
      
      fireEvent.click(screen.getByRole('button'));
      
      // Fast-forward timers
      vi.advanceTimersByTime(600);
      
      expect(mockOnDownloadComplete).toHaveBeenCalled();
      
      vi.useRealTimers();
    });
  });

  describe('Button Variants', () => {
    it('renders with primary variant by default', () => {
      const mockBlob = createMockBlob('test content');
      render(<DownloadButton file={mockBlob} filename="test.pdf" />);
      
      const button = screen.getByRole('button');
      expect(button).toHaveClass('bg-[var(--color-primary)]');
    });

    it('renders with secondary variant', () => {
      const mockBlob = createMockBlob('test content');
      render(
        <DownloadButton 
          file={mockBlob} 
          filename="test.pdf"
          variant="secondary"
        />
      );
      
      const button = screen.getByRole('button');
      expect(button).toHaveClass('bg-[var(--color-secondary)]');
    });

    it('renders with different sizes', () => {
      const mockBlob = createMockBlob('test content');
      const { rerender } = render(
        <DownloadButton 
          file={mockBlob} 
          filename="test.pdf"
          size="sm"
        />
      );
      
      let button = screen.getByRole('button');
      expect(button).toHaveClass('px-3');
      
      rerender(
        <DownloadButton 
          file={mockBlob} 
          filename="test.pdf"
          size="lg"
        />
      );
      
      button = screen.getByRole('button');
      expect(button).toHaveClass('px-6');
    });
  });

  describe('Accessibility', () => {
    it('has descriptive aria-label', () => {
      const mockBlob = createMockBlob('a'.repeat(1024));
      render(
        <DownloadButton 
          file={mockBlob} 
          filename="test.pdf"
          showFileSize={true}
        />
      );
      
      const button = screen.getByRole('button');
      expect(button).toHaveAttribute('aria-label', expect.stringContaining('Download'));
    });

    it('is focusable when enabled', () => {
      const mockBlob = createMockBlob('test content');
      render(<DownloadButton file={mockBlob} filename="test.pdf" />);
      
      const button = screen.getByRole('button');
      button.focus();
      expect(document.activeElement).toBe(button);
    });
  });

  describe('File Size Formatting', () => {
    it('formats bytes correctly', () => {
      const mockBlob = createMockBlob('a'.repeat(500));
      render(
        <DownloadButton 
          file={mockBlob} 
          filename="test.pdf"
          showFileSize={true}
        />
      );
      
      expect(screen.getByText(/Bytes/)).toBeInTheDocument();
    });

    it('formats KB correctly', () => {
      const mockBlob = createMockBlob('a'.repeat(2048));
      render(
        <DownloadButton 
          file={mockBlob} 
          filename="test.pdf"
          showFileSize={true}
        />
      );
      
      expect(screen.getByText(/KB/)).toBeInTheDocument();
    });

    it('formats MB correctly', () => {
      const mockBlob = createMockBlob('a'.repeat(1024 * 1024 * 2));
      render(
        <DownloadButton 
          file={mockBlob} 
          filename="test.pdf"
          showFileSize={true}
        />
      );
      
      expect(screen.getByText(/MB/)).toBeInTheDocument();
    });
  });

  describe('Cleanup', () => {
    it('revokes blob URL on unmount', () => {
      const mockBlob = createMockBlob('test content');
      const { unmount } = render(
        <DownloadButton file={mockBlob} filename="test.pdf" />
      );
      
      unmount();
      
      expect(mockRevokeObjectURL).toHaveBeenCalled();
    });

    it('revokes old blob URL when file changes', () => {
      const mockBlob1 = createMockBlob('content 1');
      const mockBlob2 = createMockBlob('content 2');
      
      const { rerender } = render(
        <DownloadButton file={mockBlob1} filename="test1.pdf" />
      );
      
      // Clear the mock to track only new calls
      mockRevokeObjectURL.mockClear();
      
      rerender(<DownloadButton file={mockBlob2} filename="test2.pdf" />);
      
      // Should have revoked the first URL
      expect(mockRevokeObjectURL).toHaveBeenCalled();
    });
  });

  describe('Desktop save', () => {
    beforeEach(() => {
      mockIsTauri.mockReturnValue(true);
    });

    afterEach(() => {
      mockIsTauri.mockReturnValue(false);
    });

    it('asks where to put the file instead of dropping it in the download folder', async () => {
      const mockBlob = createMockBlob('test content');
      render(<DownloadButton file={mockBlob} filename="report.pdf" toolSlug="word-to-pdf" />);

      fireEvent.click(screen.getByRole('button'));

      await waitFor(() => expect(mockSaveFile).toHaveBeenCalled());
      expect(mockSaveFile.mock.calls[0][0]).toBe('report.pdf');
      // The dialog should offer the right file type.
      expect(mockSaveFile.mock.calls[0][1]).toEqual([{ name: 'PDF', extensions: ['pdf'] }]);
      await waitFor(() => expect(mockWriteFileBytes).toHaveBeenCalled());
      expect(mockWriteFileBytes.mock.calls[0][0]).toContain('report.pdf');
    });

    it('says where the file went, since the desktop app has no download bar', async () => {
      const mockBlob = createMockBlob('test content');
      render(<DownloadButton file={mockBlob} filename="report.pdf" />);

      fireEvent.click(screen.getByRole('button'));

      const saved = await screen.findByRole('button', { name: /Saved/i });
      expect(saved).toHaveAttribute('title', expect.stringContaining('report.pdf'));
    });

    it('records the file in the history that the UI reads', async () => {
      const mockBlob = createMockBlob('test content');
      render(<DownloadButton file={mockBlob} filename="report.pdf" toolSlug="word-to-pdf" toolName="Word to PDF" />);

      fireEvent.click(screen.getByRole('button'));

      await waitFor(() => expect(mockAddRecentFile).toHaveBeenCalledWith(
        'report.pdf', mockBlob.size, 'word-to-pdf', 'Word to PDF',
      ));
    });

    it('treats a dismissed dialog as a decision, not a failure', async () => {
      mockSaveFile.mockRejectedValueOnce(new Error('No file selected'));
      const onComplete = vi.fn();
      const mockBlob = createMockBlob('test content');
      render(<DownloadButton file={mockBlob} filename="report.pdf" onDownloadComplete={onComplete} />);

      fireEvent.click(screen.getByRole('button'));

      await waitFor(() => expect(mockSaveFile).toHaveBeenCalled());
      expect(mockWriteFileBytes).not.toHaveBeenCalled();
      expect(onComplete).not.toHaveBeenCalled();
      expect(screen.queryByRole('button', { name: /Saved/i })).not.toBeInTheDocument();
    });
  });
});
