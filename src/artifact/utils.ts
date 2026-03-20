// ─── Artifact-specific utilities for SlothCV (Resume) ────────────────────────
// When forking: replace getInjectedHtml with your artifact's rendering logic,
// and replace exportArtifact with your format (PPTX, DOCX, etc).

export const compressImage = (dataUri: string): Promise<string> =>
  new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      const MAX = 400;
      const scale = Math.min(MAX / img.width, MAX / img.height, 1);
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL('image/jpeg', 0.85));
    };
    img.src = dataUri;
  });

export function getInjectedHtml(html?: string): string {
  if (!html) return '';
  const baseUrl = window.location.origin;
  const fontCss = `<style>
    * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    html, body { margin: 0 !important; padding: 0 !important; width: 210mm !important; height: 297mm !important; background-color: white; overflow: hidden; font-family: 'Inter', sans-serif; }
    @font-face { font-family: 'Inter'; src: url('${baseUrl}/fonts/Inter-Regular.woff2') format('woff2'); font-weight: 400; }
    @font-face { font-family: 'Inter'; src: url('${baseUrl}/fonts/Inter-SemiBold.woff2') format('woff2'); font-weight: 600; }
    @font-face { font-family: 'Inter'; src: url('${baseUrl}/fonts/Inter-Bold.woff2') format('woff2'); font-weight: 700; }
    @media print { @page { size: 210mm 297mm; margin: 0; } body { width: 210mm !important; height: 297mm !important; } }
  </style>`;
  return html.includes('</head>') ? html.replace('</head>', `${fontCss}</head>`) : fontCss + html;
}

export async function exportArtifact(
  html: string,
  toast: { preparing: string; opened: string; error: string },
  onToast: (msg: string, type: 'info' | 'success' | 'error') => void,
): Promise<void> {
  onToast(toast.preparing, 'info');
  const printStyles = `<style>@media print { @page { size: A4 portrait; margin: 0; } body { -webkit-print-color-adjust: exact; print-color-adjust: exact; margin: 0 !important; } }</style>`;
  const injected = getInjectedHtml(html).replace('</head>', `${printStyles}</head>`);
  const iframe = document.createElement('iframe');
  iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:794px;height:1123px;border:none;opacity:0;pointer-events:none;z-index:-9999;';
  document.body.appendChild(iframe);
  try {
    await new Promise<void>(resolve => { iframe.onload = () => resolve(); iframe.srcdoc = injected; });
    if (iframe.contentDocument && iframe.contentWindow) {
      await iframe.contentDocument.fonts.ready;
      await new Promise(r => setTimeout(r, 400));
      iframe.contentWindow.focus();
      iframe.contentWindow.print();
      onToast(toast.opened, 'success');
    }
  } catch {
    onToast(toast.error, 'error');
  } finally {
    setTimeout(() => { if (document.body.contains(iframe)) document.body.removeChild(iframe); }, 1000);
  }
}
