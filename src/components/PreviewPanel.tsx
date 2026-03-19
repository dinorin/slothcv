import { FileDown, X, ZoomIn, ZoomOut, Maximize } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { TransformWrapper, TransformComponent } from 'react-zoom-pan-pinch';
import type { ReactZoomPanPinchRef } from 'react-zoom-pan-pinch';
import { ResumeData } from '../types';

// A4 page dimensions in pixels at 96 DPI
const A4_W = 794;
const A4_H = 1123;

interface Props {
  width: number;
  isOpen: boolean;
  isResizing: boolean;
  resumeData: ResumeData | null;
  t: any;
  onResizeStart: (e: React.MouseEvent) => void;
  onClose: () => void;
  getInjectedHtml: (html?: string) => string;
}

export default function PreviewPanel({
  width, isOpen, isResizing, resumeData, t,
  onResizeStart, onClose, getInjectedHtml,
}: Props) {
  return (
    <>
      {isOpen && (
        <div
          onMouseDown={onResizeStart}
          className="w-1 cursor-col-resize hover:bg-zinc-300 dark:hover:bg-zinc-700 transition-colors z-20 shrink-0 border-x border-zinc-100 dark:border-zinc-900"
        />
      )}

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ width: 0, opacity: 0 }}
            animate={{ width, opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            transition={{ duration: isResizing ? 0 : 0.25 }}
            style={{ width }}
            className="flex flex-col shrink-0 bg-[#fafafa] dark:bg-[#0a0a0a] overflow-hidden"
          >
            <div className="flex items-center justify-between px-4 h-11 bg-white dark:bg-[#0a0a0a] border-b border-zinc-200 dark:border-zinc-800 shrink-0">
              <div className="flex items-center gap-2">
                <FileDown className="w-3.5 h-3.5 text-zinc-400" />
                <span className="text-[11px] font-semibold text-zinc-600 dark:text-zinc-400 uppercase tracking-wider">
                  {t.artifactPreview || 'ARTIFACT PREVIEW'}
                </span>
              </div>
              <button
                onClick={onClose}
                className="p-1.5 rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-800/50 text-zinc-400 transition-colors"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="flex-1 overflow-hidden relative bg-zinc-100 dark:bg-[#050505]">
              {resumeData?.resume_html ? (
                <TransformWrapper
                  initialScale={0.5}
                  minScale={0.2}
                  maxScale={4}
                  centerOnInit
                  limitToBounds={false}
                  wheel={{ step: 0.08 }}
                  alignmentAnimation={{ sizeX: 0, sizeY: 0 }}
                  onInit={(ref: ReactZoomPanPinchRef) => {
                    // Wait for the panel open animation (250ms) to finish before centering
                    setTimeout(() => {
                      const wrapper = ref.instance.wrapperComponent;
                      if (!wrapper) return;
                      const scale = Math.min((wrapper.clientWidth - 64) / A4_W, (wrapper.clientHeight - 32) / A4_H, 1);
                      const x = Math.max(0, (wrapper.clientWidth - A4_W * scale) / 2);
                      const y = Math.max(24, (wrapper.clientHeight - A4_H * scale) / 2);
                      ref.setTransform(x, y, scale, 0);
                    }, 280);
                  }}
                >
                  {({ zoomIn, zoomOut, setTransform, instance }) => {
                    const handleFitPage = () => {
                      const wrapper = instance.wrapperComponent;
                      if (!wrapper) return;
                      const scale = Math.min((wrapper.clientWidth - 64) / A4_W, (wrapper.clientHeight - 32) / A4_H, 1);
                      const x = Math.max(0, (wrapper.clientWidth - A4_W * scale) / 2);
                      setTransform(x, 24, scale, 250);
                    };
                    return (
                      <>
                        <div className="absolute top-4 right-4 z-10 flex items-center gap-1 bg-white/90 dark:bg-zinc-900/90 backdrop-blur-sm border border-zinc-200 dark:border-zinc-800 p-1 rounded-lg shadow-sm">
                          <button onClick={() => zoomOut()} className="p-1.5 text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-md transition-colors" title={t.zoomOut}>
                            <ZoomOut className="w-3.5 h-3.5" />
                          </button>
                          <button onClick={handleFitPage} className="p-1.5 text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-md transition-colors" title="Fit Page">
                            <Maximize className="w-3.5 h-3.5" />
                          </button>
                          <button onClick={() => zoomIn()} className="p-1.5 text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-md transition-colors" title={t.zoomIn}>
                            <ZoomIn className="w-3.5 h-3.5" />
                          </button>
                        </div>
                        <TransformComponent
                          wrapperClass="!w-full !h-full cursor-grab active:cursor-grabbing"
                          contentClass="flex items-start justify-center min-w-full min-h-full"
                        >
                          <div
                            className="bg-white shadow-[0_0_50px_rgba(0,0,0,0.1)] dark:shadow-[0_0_50px_rgba(0,0,0,0.3)]"
                            style={{ width: '210mm', height: '297mm', flexShrink: 0, transformOrigin: 'top center' }}
                          >
                            <iframe
                              srcDoc={getInjectedHtml(resumeData.resume_html)}
                              title="Resume Preview"
                              sandbox="allow-same-origin allow-scripts"
                              style={{ width: '100%', height: '100%', border: 'none', display: 'block', pointerEvents: 'none' }}
                            />
                          </div>
                        </TransformComponent>
                      </>
                    );
                  }}
                </TransformWrapper>
              ) : (
                <div className="flex flex-col items-center justify-center h-full text-zinc-400 space-y-3">
                  <FileDown className="w-8 h-8 opacity-20" />
                  <p className="text-[12px] font-medium">{t.noResumeData}</p>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
