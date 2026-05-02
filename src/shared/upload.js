// Shared upload utilities used by every "user uploads files" surface.
// Currently:
//   - EditPanel Documents tab (Project Documents)
//   - PMReportPhotos (PM Daily Report photo grid)
//
// Both surfaces have their own bucket / DB target / row shape; what's
// actually shared is the bits BEFORE the upload itself: HEIC->JPEG
// conversion (so iPhone photos display in any browser) and paste-from-
// clipboard handling.

import { useEffect, useRef } from 'react';

// ─── HEIC -> JPEG conversion ───
// iOS devices photograph in HEIC by default; desktop browsers can't
// render it natively. Detect by extension or MIME and convert client-
// side via heic2any (lazy-imported, ~338 KB chunk that only loads when
// a HEIC is actually picked).
//
// Returns the converted JPEG File, or the original file if no conversion
// was needed. Throws on conversion failure -- caller decides how to
// surface the error (toast / alert / silent skip).
export async function convertHeicIfNeeded(file) {
  if (!file) return file;
  const name = (file.name || '').toLowerCase();
  const isHeic = name.endsWith('.heic') || name.endsWith('.heif')
    || file.type === 'image/heic' || file.type === 'image/heif';
  if (!isHeic) return file;
  const { default: heic2any } = await import('heic2any');
  const blob = await heic2any({ blob: file, toType: 'image/jpeg', quality: 0.9 });
  const out = Array.isArray(blob) ? blob[0] : blob;
  const newName = file.name.replace(/\.(heic|heif)$/i, '.jpg');
  return new File([out], newName, { type: 'image/jpeg', lastModified: Date.now() });
}

// ─── Paste-to-upload hook ───
// Listens for clipboard paste events while `active` is true. Files in
// the clipboard (e.g., screenshots) are passed to `onFiles`. Paste
// events targeting form fields (input, textarea, contenteditable) are
// ignored so users can still paste text into description/comment inputs.
//
// Uses a ref for `onFiles` so callers don't need to memoize it -- the
// ref tracks the latest closure each render.
export function usePasteUpload({ active, onFiles }) {
  const handlerRef = useRef(null);
  useEffect(() => { handlerRef.current = onFiles; });
  useEffect(() => {
    if (!active) return undefined;
    const onPaste = (e) => {
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      const items = e.clipboardData?.items || [];
      const files = [];
      for (const item of items) {
        if (item.kind === 'file') {
          const f = item.getAsFile();
          if (f) files.push(f);
        }
      }
      if (files.length) {
        e.preventDefault();
        handlerRef.current?.(files);
      }
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, [active]);
}
