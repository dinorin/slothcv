import { useState, useEffect } from 'react';

export function useResizable(
  direction: 'sidebar' | 'preview',
  initial: number,
  min: number,
  max: number,
) {
  const [width, setWidth] = useState(initial);
  const [isResizing, setIsResizing] = useState(false);

  const startResizing = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
  };

  useEffect(() => {
    if (!isResizing) {
      document.body.style.cursor = 'default';
      return;
    }

    document.body.style.cursor = 'col-resize';

    const onMove = (e: MouseEvent) => {
      const newWidth =
        direction === 'sidebar'
          ? Math.max(min, Math.min(max, e.clientX))
          : Math.max(min, Math.min(max, window.innerWidth - e.clientX));
      setWidth(newWidth);
    };

    const onUp = () => setIsResizing(false);

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
  }, [isResizing, direction, min, max]);

  return { width, setWidth, isResizing, startResizing };
}
