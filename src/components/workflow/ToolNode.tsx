'use client';

import React, { memo, useState } from 'react';
import { Handle, Position, useReactFlow } from 'reactflow';
import { useTranslations } from 'next-intl';
import { ToolNodeData } from '@/types/workflow';
import * as LucideIcons from 'lucide-react';
import { X } from 'lucide-react';

type TranslateFn = ReturnType<typeof useTranslations>;

interface ToolNodeProps {
    id: string;
    data: ToolNodeData;
    selected?: boolean;
    isConnectable?: boolean;
}

/**
 * Socket color helper inspired by BentoPDF socket types
 */
function getSocketColor(format?: string | string[]): { bg: string; border: string; label: string } {
    const fmt = Array.isArray(format) ? format[0]?.toLowerCase() : format?.toLowerCase();
    if (!fmt || fmt === '*' || fmt === 'any') {
        return { bg: '#8b5cf6', border: '#7c3aed', label: 'Any Format' };
    }
    if (fmt.includes('pdf')) {
        return { bg: '#6366f1', border: '#4f46e5', label: 'PDF Document' };
    }
    if (fmt.includes('image') || fmt.includes('jpg') || fmt.includes('png') || fmt.includes('webp') || fmt.includes('svg')) {
        return { bg: '#10b981', border: '#059669', label: 'Image' };
    }
    if (fmt.includes('word') || fmt.includes('excel') || fmt.includes('ppt') || fmt.includes('office') || fmt.includes('docx') || fmt.includes('pptx') || fmt.includes('xlsx')) {
        return { bg: '#f59e0b', border: '#d97706', label: 'Office Document' };
    }
    if (fmt.includes('txt') || fmt.includes('json') || fmt.includes('markdown') || fmt.includes('text') || fmt.includes('csv')) {
        return { bg: '#06b6d4', border: '#0891b2', label: 'Text / Data' };
    }
    if (fmt.includes('zip') || fmt.includes('archive')) {
        return { bg: '#ec4899', border: '#db2777', label: 'ZIP Archive' };
    }
    return { bg: '#6366f1', border: '#4f46e5', label: fmt };
}

/**
 * Category badge styles
 */
const categoryBadgeStyles: Record<string, { bg: string; text: string; label: string }> = {
    'flow-control': { bg: 'bg-purple-100 dark:bg-purple-950/60', text: 'text-purple-700 dark:text-purple-300', label: 'Flow Control' },
    'organize-manage': { bg: 'bg-blue-100 dark:bg-blue-950/60', text: 'text-blue-700 dark:text-blue-300', label: 'Organize' },
    'edit-annotate': { bg: 'bg-indigo-100 dark:bg-indigo-950/60', text: 'text-indigo-700 dark:text-indigo-300', label: 'Edit' },
    'convert-to-pdf': { bg: 'bg-emerald-100 dark:bg-emerald-950/60', text: 'text-emerald-700 dark:text-emerald-300', label: 'Convert to PDF' },
    'convert-from-pdf': { bg: 'bg-amber-100 dark:bg-amber-950/60', text: 'text-amber-700 dark:text-amber-300', label: 'Convert from PDF' },
    'optimize-repair': { bg: 'bg-cyan-100 dark:bg-cyan-950/60', text: 'text-cyan-700 dark:text-cyan-300', label: 'Optimize' },
    'secure-pdf': { bg: 'bg-rose-100 dark:bg-rose-950/60', text: 'text-rose-700 dark:text-rose-300', label: 'Security' },
    'output': { bg: 'bg-pink-100 dark:bg-pink-950/60', text: 'text-pink-700 dark:text-pink-300', label: 'Output' },
};

/**
 * Extract an intuitive 1-line parameter summary for the node card.
 * Takes `t` as a parameter since hooks can't be called from a plain helper.
 */
function getNodeSettingsSummary(t: TranslateFn, toolId: string, settings?: Record<string, unknown>): string | null {
    const tn = (key: string, fallback: string) => t(`toolNode.${key}`) || fallback;

    if (!settings || Object.keys(settings).length === 0) {
        if (toolId === 'rotate-pdf') return tn('rotateDefault', 'Rotate: 90° clockwise');
        if (toolId === 'compress-pdf') return tn('compressDefault', 'Medium quality (standard algorithm)');
        if (toolId === 'split-pdf') return tn('splitDefault', 'Split by single page');
        if (toolId === 'download-pdf') return tn('downloadPdfDefault', 'Save: output.pdf');
        if (toolId === 'download-zip') return tn('downloadZipDefault', 'Archive: output.zip');
        return null;
    }

    switch (toolId) {
        case 'rotate-pdf': {
            const angle = settings.angle ?? 90;
            return `${tn('rotateLabel', 'Rotate')}: ${angle}°`;
        }
        case 'add-watermark': {
            const isImage = settings.watermarkType === 'image';
            const isRepeat = Boolean(settings.repeat);
            if (isImage) {
                return isRepeat
                    ? tn('watermarkImageTiled', 'Image watermark (tiled)')
                    : tn('watermarkImage', 'Image watermark');
            }
            const text = String(settings.text || 'CONFIDENTIAL');
            return isRepeat
                ? `${tn('watermarkTiledLabel', 'Tiled watermark')}: "${text}"`
                : `${tn('watermarkLabel', 'Watermark')}: "${text}"`;
        }
        case 'compress-pdf': {
            const quality = String(settings.quality || 'medium');
            const qualityMap: Record<string, string> = {
                low: tn('qualityLow', 'Low size'),
                medium: tn('qualityMedium', 'Medium quality'),
                high: tn('qualityHigh', 'High quality'),
                maximum: tn('qualityMaximum', 'Best quality'),
            };
            const algo = String(settings.algorithm || 'standard');
            return `${qualityMap[quality] || quality} (${algo})`;
        }
        case 'split-pdf': {
            const mode = String(settings.splitMode || 'every-page');
            if (mode === 'every-n-pages') {
                return `${tn('splitEveryNLabel', 'Split every')} ${settings.pagesPerSplit || 1} ${tn('splitEveryNSuffix', 'pages')}`;
            }
            if (mode === 'ranges' && settings.pageRanges) {
                return `${tn('rangeLabel', 'Range')}: ${settings.pageRanges}`;
            }
            return tn('splitDefault', 'Split by single page');
        }
        case 'page-numbers': {
            const pos = String(settings.position || 'bottom-center');
            const posMap: Record<string, string> = {
                'top-left': tn('posTopLeft', 'Top left'),
                'top-center': tn('posTopCenter', 'Top center'),
                'top-right': tn('posTopRight', 'Top right'),
                'bottom-left': tn('posBottomLeft', 'Bottom left'),
                'bottom-center': tn('posBottomCenter', 'Bottom center'),
                'bottom-right': tn('posBottomRight', 'Bottom right'),
            };
            return `${tn('pageNumbersLabel', 'Page numbers')}: ${posMap[pos] || pos} (${tn('startingAtPage', 'starting at page')} ${settings.startNumber || 1})`;
        }
        case 'download-pdf': {
            return `${tn('saveLabel', 'Save')}: ${settings.filename || 'output.pdf'}`;
        }
        case 'download-zip': {
            return `${tn('zipLabel', 'ZIP')}: ${settings.filename || 'output.zip'}`;
        }
        case 'djvu-to-pdf': {
            const dpi = settings.dpi || 150;
            return `${tn('dpiLabel', 'DPI')}: ${dpi}`;
        }
        case 'condition-gateway': {
            const type = String(settings.conditionType || 'file-count');
            const op = String(settings.operator || 'greater-than');
            const opMap: Record<string, string> = {
                'greater-than': '>', 'less-than': '<', 'equals': '=', 'not-equals': '!=',
                'contains': tn('opContains', 'contains'),
                'ends-with': tn('opEndsWith', 'ends with'),
            };
            const typeMap: Record<string, string> = {
                'file-count': tn('typeFileCount', 'File count'),
                'file-size': tn('typeFileSize', 'Size'),
                'file-format': tn('typeFileFormat', 'Format'),
            };
            return `${typeMap[type] || type} ${opMap[op] || op} ${settings.value ?? 1}${type === 'file-size' ? (settings.sizeUnit || 'MB') : ''}`;
        }
        case 'n-up-pdf': {
            return `${settings.pagesPerSheet || 4} ${tn('perSheet', 'per sheet')} (${settings.pageSize || 'A4'})`;
        }
        case 'extract-pages':
        case 'delete-pages': {
            return `${tn('pagesLabel', 'Pages')}: ${settings.pageRange || '1'}`;
        }
        case 'ocr-pdf': {
            return `OCR: ${settings.language || settings.languages || 'eng'}`;
        }
        case 'encrypt-pdf': {
            return settings.userPassword ? tn('passwordProtected', 'Password protected') : tn('encryptedSecure', 'Encrypted');
        }
        case 'flatten-pdf': {
            return tn('flattenSummary', 'Flatten forms & annotations');
        }
        case 'table-of-contents': {
            return `${tn('tocLabel', 'TOC')}: "${settings.title || 'Table of Contents'}"`;
        }
        case 'header-footer': {
            const parts = [];
            if (settings.headerText) parts.push(`${tn('headerLabel', 'Header')}: "${settings.headerText}"`);
            if (settings.footerText) parts.push(`${tn('footerLabel', 'Footer')}: "${settings.footerText}"`);
            return parts.join(' | ') || tn('headerFooterDefault', 'Header & footer');
        }
        case 'background-color': {
            return `${tn('backgroundColorLabel', 'Background')}: ${settings.color || '#FFFFFF'}`;
        }
        case 'text-color': {
            return `${tn('textColorLabel', 'Text color')}: ${settings.color || '#000000'}`;
        }
        default: {
            if (settings.filename) return `${settings.filename}`;
            if (settings.quality) return `${tn('qualityLabel', 'Quality')}: ${settings.quality}`;
            if (settings.color) return `${tn('colorLabel', 'Color')}: ${settings.color}`;
            return null;
        }
    }
}

/**
 * Custom Tool Node for ReactFlow
 * Displays a PDF tool as a draggable node in the workflow
 */
const ToolNode = memo(({ id, data, selected = false, isConnectable = true }: ToolNodeProps) => {
    const [isHovered, setIsHovered] = useState(false);
    const { deleteElements } = useReactFlow();
    const t = useTranslations('workflow');

    // Get the icon component dynamically
    const iconName = toPascalCase(data.icon);
    const IconComponent = (LucideIcons as unknown as Record<string, React.ComponentType<{ className?: string }>>)[iconName]
        || LucideIcons.FileText;

    // Handle delete node
    const handleDelete = (event: React.MouseEvent) => {
        event.stopPropagation(); // Prevent node click from triggering
        deleteElements({ nodes: [{ id }] });
    };

    // Status colors
    const statusColors: Record<ToolNodeData['status'], string> = {
        idle: 'bg-[var(--color-muted)]',
        processing: 'bg-blue-50/90 dark:bg-blue-950/40 border-blue-400',
        complete: 'bg-emerald-50/90 dark:bg-emerald-950/40 border-emerald-400',
        error: 'bg-rose-50/90 dark:bg-rose-950/40 border-rose-400',
        skipped: 'bg-gray-100/70 dark:bg-gray-800/40 border-dashed border-gray-300 dark:border-gray-600 opacity-60',
    };

    // Status indicator colors
    const statusIndicatorColors: Record<ToolNodeData['status'], string> = {
        idle: 'bg-gray-300 dark:bg-gray-600',
        processing: 'bg-blue-500 animate-ping',
        complete: 'bg-emerald-500',
        error: 'bg-rose-500',
        skipped: 'bg-gray-400',
    };

    // Category border-left accent
    const categoryBorders: Record<string, string> = {
        'flow-control': 'border-l-purple-500',
        'organize-manage': 'border-l-blue-500',
        'edit-annotate': 'border-l-indigo-500',
        'convert-to-pdf': 'border-l-emerald-500',
        'convert-from-pdf': 'border-l-amber-500',
        'optimize-repair': 'border-l-cyan-500',
        'secure-pdf': 'border-l-rose-500',
        'output': 'border-l-pink-500',
    };

    const badge = categoryBadgeStyles[data.category] || {
        bg: 'bg-gray-100 dark:bg-gray-800',
        text: 'text-gray-700 dark:text-gray-300',
        label: data.category,
    };

    const inputSocket = getSocketColor(data.acceptedFormats);
    const outputSocket = getSocketColor(data.outputFormat);
    const settingsSummary = getNodeSettingsSummary(t, data.toolId, data.settings);

    return (
        <div
            className={`
        relative px-3.5 py-3 rounded-xl shadow-md border-2 border-l-4 transition-all duration-200
        w-[240px]
        ${statusColors[data.status]}
        ${categoryBorders[data.category] || 'border-l-gray-400'}
        ${selected ? 'ring-2 ring-[var(--color-primary)] ring-offset-2' : ''}
        ${isHovered ? 'shadow-xl scale-[1.02]' : ''}
        ${data.status === 'processing' ? 'ring-2 ring-blue-500 shadow-[0_0_15px_rgba(59,130,246,0.5)]' : ''}
      `}
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
        >
            {/* Delete Button - shown on hover */}
            {isHovered && (
                <button
                    onClick={handleDelete}
                    className="absolute -top-2 -right-2 w-5 h-5 bg-rose-500 hover:bg-rose-600 rounded-full flex items-center justify-center shadow-md transition-colors z-10"
                    title="Delete node"
                >
                    <X className="w-3 h-3 text-white" />
                </button>
            )}

            {/* Input Handle with format-aware semantic color and tooltip */}
            <Handle
                type="target"
                position={Position.Left}
                isConnectable={isConnectable}
                style={{
                    backgroundColor: inputSocket.bg,
                    borderColor: '#ffffff',
                }}
                className="!w-3.5 !h-3.5 !border-2 shadow-sm transition-transform hover:scale-125"
                title={`${t('toolNode.inputType') || 'Input type'}: ${inputSocket.label}`}
            />

            {/* Top Category Badge */}
            <div className="flex items-center justify-between mb-2">
                <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${badge.bg} ${badge.text}`}>
                    {badge.label}
                </span>
                <div className="flex items-center gap-1.5">
                    <div className={`w-2 h-2 rounded-full ${statusIndicatorColors[data.status]}`} />
                    <span className="text-[11px] text-[var(--color-muted-foreground)] capitalize font-medium">
                        {data.status}
                    </span>
                </div>
            </div>

            {/* Main Content */}
            <div className="flex items-center gap-2.5">
                {/* Icon */}
                <div className={`
                    p-2 rounded-lg shrink-0 shadow-xs
                    ${data.status === 'processing' ? 'bg-blue-200 dark:bg-blue-900/60' : 'bg-white dark:bg-gray-800/80'}
                `}>
                    <IconComponent className="w-4 h-4 text-[var(--color-foreground)]" />
                </div>

                {/* Label */}
                <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-[var(--color-foreground)] truncate leading-tight">
                        {data.label}
                    </p>
                    {data.toolId && (
                        <p className="text-[10px] text-[var(--color-muted-foreground)] truncate mt-0.5 font-mono opacity-80">
                            {data.toolId}
                        </p>
                    )}
                </div>
            </div>

            {/* Inline Parameter Summary Badge */}
            {settingsSummary && (
                <div className="mt-2 flex items-center gap-1.5 px-2 py-1 rounded-md bg-[color-mix(in_srgb,var(--color-muted)_70%,transparent)] dark:bg-gray-800/60 border border-[color-mix(in_srgb,var(--color-border)_60%,transparent)] text-[11px] text-[var(--color-foreground)] font-medium truncate" title={`${t('toolNode.parameterLabel') || 'Parameter'}: ${settingsSummary}`}>
                    <LucideIcons.Sliders className="w-3 h-3 text-[var(--color-primary)] shrink-0" />
                    <span className="truncate">{settingsSummary}</span>
                </div>
            )}

            {/* Progress bar */}
            {data.status === 'processing' && (
                <div className="mt-2.5 w-full h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                    <div
                        className="h-full bg-blue-500 rounded-full transition-all duration-300"
                        style={{ width: `${data.progress}%` }}
                    />
                </div>
            )}

            {/* Error message */}
            {data.status === 'error' && data.error && (
                <p className="mt-2 text-xs text-rose-600 dark:text-rose-400 truncate">
                    {data.error}
                </p>
            )}

            {/* Output file count indicator */}
            {data.status === 'complete' && data.outputFiles && data.outputFiles.length > 0 && (
                <div className="mt-2 flex items-center gap-1.5">
                    <LucideIcons.CheckCircle className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
                    <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-medium">
                        {data.outputFiles.length} {t('toolNode.generatedFiles') || 'generated file(s)'}
                    </span>
                </div>
            )}

            {/* Format tags with socket color dots */}
            <div className="flex items-center justify-between gap-1 mt-2.5 pt-2 border-t border-[color-mix(in_srgb,var(--color-border)_50%,transparent)]">
                <div className="flex items-center gap-1 text-[10px] text-[var(--color-muted-foreground)] truncate max-w-[100px]" title={data.acceptedFormats.join(', ')}>
                    <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: inputSocket.bg }} />
                    <span className="truncate">{data.acceptedFormats.slice(0, 1).join(', ') || '*'}</span>
                </div>
                <LucideIcons.ArrowRight className="w-2.5 h-2.5 text-[var(--color-muted-foreground)] shrink-0 opacity-50" />
                <div className="flex items-center gap-1 text-[10px] text-[var(--color-muted-foreground)] truncate max-w-[90px]" title={data.outputFormat}>
                    <span className="truncate">{data.outputFormat || '*'}</span>
                    <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: outputSocket.bg }} />
                </div>
            </div>

            {/* Output Handle with format-aware semantic color and tooltip */}
            <Handle
                type="source"
                position={Position.Right}
                isConnectable={isConnectable}
                style={{
                    backgroundColor: outputSocket.bg,
                    borderColor: '#ffffff',
                }}
                className="!w-3.5 !h-3.5 !border-2 shadow-sm transition-transform hover:scale-125"
                title={`${t('toolNode.outputType') || 'Output type'}: ${outputSocket.label}`}
            />
        </div>
    );
});

ToolNode.displayName = 'ToolNode';

/**
 * Convert kebab-case to PascalCase for icon lookup
 */
function toPascalCase(str: string): string {
    return str
        .split('-')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join('');
}

export default ToolNode;

