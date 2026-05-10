import { useState, useEffect, useCallback } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { invoke } from '@tauri-apps/api/core';
import CloseConfirmDialog from './CloseConfirmDialog';

const STORAGE_KEY = 'ecdraw-close-behavior';
const isTauri = () => !!(window as any).__TAURI_INTERNALS__;

export default function WindowControls() {
  const [maximized, setMaximized] = useState(false);
  const [showCloseDialog, setShowCloseDialog] = useState(false);
  const tauri = isTauri();

  useEffect(() => {
    if (!tauri) return;
    const appWindow = getCurrentWindow();
    let disposed = false;
    appWindow.isMaximized().then((v) => { if (!disposed) setMaximized(v); });
    const unlisten = appWindow.onResized(async () => {
      if (disposed) return;
      setMaximized(await appWindow.isMaximized());
    });
    return () => { disposed = true; unlisten.then((fn) => fn()); };
  }, [tauri]);

  const handleClose = useCallback(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'hide') {
      getCurrentWindow().close();
    } else if (saved === 'exit') {
      invoke('exit_app');
    } else {
      setShowCloseDialog(true);
    }
  }, []);

  const handleHideToTray = useCallback((remember: boolean) => {
    if (remember) {
      localStorage.setItem(STORAGE_KEY, 'hide');
    }
    setShowCloseDialog(false);
    getCurrentWindow().close();
  }, []);

  const handleExit = useCallback((remember: boolean) => {
    if (remember) {
      localStorage.setItem(STORAGE_KEY, 'exit');
    }
    setShowCloseDialog(false);
    invoke('exit_app');
  }, []);

  if (!tauri) return null;

  const appWindow = getCurrentWindow();

  return (
    <>
      <div className="win-controls">
        <button className="win-btn" title="最小化" onClick={() => appWindow.minimize()}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.2">
            <line x1="3" y1="10" x2="11" y2="10" />
          </svg>
        </button>
        <button className="win-btn" title={maximized ? '还原' : '最大化'} onClick={() => appWindow.toggleMaximize()}>
          {maximized ? (
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.2">
              <rect x="3.5" y="5.5" width="6" height="6" />
              <polyline points="5.5,5.5 5.5,3 11,3 11,8.5" />
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.2">
              <rect x="2.5" y="2.5" width="9" height="9" />
            </svg>
          )}
        </button>
        <button className="win-btn win-btn-close" title="关闭" onClick={handleClose}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3">
            <line x1="3.5" y1="3.5" x2="10.5" y2="10.5" />
            <line x1="10.5" y1="3.5" x2="3.5" y2="10.5" />
          </svg>
        </button>
      </div>

      {showCloseDialog && (
        <CloseConfirmDialog
          onHideToTray={handleHideToTray}
          onExit={handleExit}
          onClose={() => setShowCloseDialog(false)}
        />
      )}
    </>
  );
}
